# 端口管理插件(ports)设计

日期:2026-10-21
状态:已落地(0.4.2,提交 5a008fbc;视觉迭代与家族层级见同批 abfb619f/736a2da0/025c21e1/3db7ad6a)

## 背景与目标

本机开发常态是十几个终端同时拉起 dev server / 数据库 / 转发隧道,端口被谁占着、想关掉,目前要开终端敲 `lsof` / `netstat`。目标:右栏工具栏(rail)新增「端口」入口,中央 tab 形式管理本机全部 TCP 监听端口:

1. 列出端口号 + 监听地址 + 进程(pid/命令行),父子进程(如 npm→node 双监听)折叠归组;
2. 标注端口大概是干什么的(静态释义库 + 暴露面);
3. 从进程 cwd 反查 git 仓库顶层并展示,命中已知 workspace 显示 workspace 名;
4. 调系统默认浏览器打开 `http://localhost:<port>`;
5. 结束所选端口的监听进程(二次确认);
6. mac / win / linux 三平台兼容,平台能力差异诚实降级。

## 方案取舍

**选定:纯 TS 插件,`ipc.procCommunicate` 按平台跑系统工具。** 扫描 = 每平台 2-4 条命令,解析归 TS 纯函数:

| 平台 | 端口+pid | 进程名/ppid/命令行 | cwd | git 顶层 |
|---|---|---|---|---|
| macOS | `lsof -nP -iTCP -sTCP:LISTEN +c0` | `ps -axo pid=,ppid=,args=` | `lsof -a -d cwd -Fn -p <pid,...>` | `git -C <cwd> rev-parse --show-toplevel` 批循环 |
| Linux | `ss -H -tlnp`(缺失回落 `netstat -tlnp`) | 同上 | `readlink /proc/<pid>/cwd` 批循环 | 同上 |
| Windows | `netstat -ano -p tcp` | PowerShell `Get-CimInstance Win32_Process`(name/ppid/CommandLine) | 无公共 API → 显示 —,git 标注随之降级 | 同左 |

理由:零 Rust/内核改动,交付面最小(anim 同款「零内核零 Rust」先例);工具链 mac/linux 自带,Windows 的 netstat 自带。缺点是每次扫描 spawn 数个子进程(百毫秒级)——本插件是手动刷新 + 可选 5s 轮询的低频面,不成立为问题。

**否决:Rust 原生扫描命令**(GetExtendedTcpTable / procfs / libproc)。mac cwd 需引 libproc 新依赖、Windows cwd 无公共 API 依旧要降级,三平台三套原生代码换来的只有扫描延迟,低频场景收益不存在。

**kill 语义**:mac/linux 先 SIGTERM,1.5s 后仍存活(`process_alive`)补 SIGKILL;Windows 直接 `taskkill /F /T /PID <pid>`(杀树,dev server 包装层一并收)。前置 ConfirmDialog(仓内统一口径,原生 confirm 清零轮)。

**平台探测**:`navigator.userAgent`(Tauri webview UA 含 Macintosh/Windows/X11 Linux),零 IPC。

## 附加功能(7 项,全部落地)

1. **暴露面标注**:`*`/`0.0.0.0`/`[::]` → 「局域网可访问」警示 chip,`127.0.0.1`/`::1` → 「仅本机」;误开全网卡的 dev server 一眼可见;
2. **端口释义库**:内置 ~40 条常见端口词典(22 ssh / 5432 postgres / 3000 node dev / 5173 vite / 1420 tauri dev / 9229 node inspector 等),未命中显示 —(进程短名由进程列承载,不重复);
3. **搜索过滤**:顶栏输入框,按端口号/pid/进程名/仓库路径即时过滤;
4. **自动刷新 + 新端口高亮**:默认手动刷新,可开 5s 自动轮询(localStorage 记忆);两次扫描 diff 出新监听打 NEW 标;
5. **复制动作**:行内复制 `http://localhost:<port>`、复制 kill 命令(贴任意终端可复用);
6. **tmd-cli 会话归因**:监听进程沿 ppid 链上溯(深度限 32),命中本应用 PTY 会话 pid → 标「由哪个会话起」,点击跳回该会话;多终端场景一眼定位 dev server 来源,本应用独有;
7. **工作区认领**:git 顶层命中已知 workspace → 显示 workspace 名替代裸路径。

## 架构落点

- 新插件 `src/plugins/ports/`:`index.tsx`(注册面)/ `tabs.ts`(kind/id/打开封装)/ `types.ts` / `platform.ts`(平台探测)/ `portsParse.ts`(三平台解析纯函数)/ `portsScan.ts`(编排:扫描→enrich→归因)/ `portsKill.ts` / `purpose.ts`(释义库)/ `PortsView.tsx` + 子组件(tab UI)/ `locales.ts`(en+ja)/ 解析与归组纯函数测试;
- 注册:`allPlugins` 一行 + `tabContent.contract.test.ts` OPENABLE_KINDS 一行;`registerSidebarAction({ rail: true, railGroup: "machine", opensCenterTab: true })`(与 SSH/WSL/终端同组,order 25)+ `registerTabContent(kind "ports.manager")`;
- 内核/Rust 零改动;无新依赖;单文件守 300 行铁则。

## 验证

- 解析纯函数:用本机真实捕获的 `lsof`/`ps`/`netstat` 输出做 fixtures 单测(vitest);
- 会话归因/折叠归组:合成 ppid 图谱单测(链上溯、深度上限、环防御);
- `pnpm check:gate` 全链 + `npx react-doctor@latest -y` 100;
- 1421 浏览器桩目检:桩 `proc_communicate` 回放真实 fixture 文本,目检列表/折叠/过滤/NEW 标/确认弹窗;
- kill 命令形状:bash 实跑同形命令(`kill -TERM` → 存活 → `kill -9` / taskkill 形状核对)验证语义。
