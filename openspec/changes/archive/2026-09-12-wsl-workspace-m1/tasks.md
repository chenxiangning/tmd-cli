# 任务分解:WSL 支持 M1

前置 P-1 = 本变更唯一的"实施前准备":需求收敛自三原型 + 记忆 #82,先出正式 spec(AGENTS.md 铁律:设计探索期原型 → 需求收敛后 spec)。Windows 实机是硬前置(纯 macOS 无法验收 wsl.exe/9P/ConPTY)。

## 0. spec 收敛(实施前)

- [x] 0.1 写 `docs/superpowers/specs/2026-09-11-wsl-workspace-m1-design.md`(16f295a):四段齐;M1 边界 = proposal「明确降级/遗留」六条 + spec §4 降级矩阵;docs/README 登记 spec(原型行由并行会话补登)
- [ ] 0.2 真 Windows 机冒烟探针(一次性脚本,不入仓):`wsl.exe -l -v --running` JSON 化输出稳定性、`--cd` Linux/Windows 路径双形态行为、UNC `\\wsl.localhost` 与 `\\wsl$\` 老写法可达性、9P 列目录实测延迟量级 → 结论写进 spec「验证」节
  - [x] 0.2a(2026-09-11 经 SSH 远程实测 192.168.1.7):`-l -v` 管道/exec 输出**仍为 UTF-16LE**(并不因非 console 转 UTF-8;`WSL_UTF8=1` 才是 UTF-8)——wsl_remote.rs 按含 NUL 特征自适应解码;spawn 包装 `wsl.exe -d <distro> --cd <linux路径> -- bash -lc '…'` 经 ssh exec 实测可跑通(注意宿主 DefaultShell 可能是 PowerShell:单引号串=字面量,防 `$VAR` 吞噬)
- [x] 0.3 spec 评审通过(2026-09-11 大仙指令「整利索到可执行状态」= 授权开工);1.x 放行,唯 1.2/4.3 实机项等 Windows 机到位

## 1. Rust 原语(src-tauri)

- [ ] 1.1 `wsl.rs`:`wsl_list_distros`(名称/版本/运行态,过滤 docker-desktop/workspace 类系统发行版)+ `wsl_list_dir`(bash `ls -1` 懒加载,回 `{entries:[{name,isDir}], path}` 形态守 repos_scan.rs:104 回拼纪律)
- [ ] 1.2 spawn 路由:`session_spawn` 认 `workspace.kind==wsl` → 包装 `wsl.exe -d <distro> --cd <path> -- bash -lc '<cmd>'`;cwd 存 Linux 形态;ConPTY 路径回归(pty_spawn.rs:76 CPR 代答已在)
- [ ] 1.3 `fs_remove.rs` 白名单扩 `\\wsl.localhost` 前缀(trust-boundary;单测:UNC 内允许、UNC 外越界拒绝、符号链接逃逸拒绝)
  - 2026-09-12 收口裁决:未实施。远程磁盘 M1 只读,删盘按「删除意图」tombstone 降级(数据保留);本机 UNC 删盘走 Windows fs 原生 9P。真实需求撞墙时再按原单测方案补。
- [ ] 1.4 `WorkspaceMeta` 加 `kind/distro`(session.rs:41)+ `SessionMeta.kind` 消费面回归

## 2. kernel + UI(TS)

- [ ] 2.1 `workspace.ts`/`ipc.ts` 类型:`Workspace.kind?: "wsl"` + `distro?`(缺省 = 本地,老数据零迁移)
- [ ] 2.2 `wslTypes.ts`:发行版连接 settings 持久化(抄 sshTypes.ts:7 惯例)
- [ ] 2.3 添加工作区弹层双 tab「本地目录 | WSL 发行版」(原型 3 交互点 1;发行版下拉运行态可选/停止置灰;`wsl_list_dir` 逐级懒加载 + 骨架)
- [ ] 2.4 工作区卡 WSL 徽章 + 中央浅黄信息条(可关,原型 3 交互点 2)
- [ ] 2.5 文件树 UNC 索引态:「索引 N 文件 · Xs(UNC)」+ 懒加载骨架(交互点 3);git 面板 tab 按 kind 置灰 + tooltip(交互点 4);右键「在 WSL 终端打开此处」→ 内嵌幕布(交互点 5)
- [ ] 2.6 各 cli-* listSessions 经 UNC 零改动回归(claude/kimi/qoder/omp/pi JSONL + opencode sqlite → WAL 锁风险降级显 `—` 实测)

## 3. 路径判定审计(易漏项,逐点核)

- [ ] 3.1 grep 全库裸 "/" 拼接点(useCkptScope/promptStore/repoContext/configGui 等记忆 #82 所列),逐处按「回拼输入 root 形态」纪律修正;每处一行改动 + 注释
- [ ] 3.2 大小写/分隔符敏感比较核正(CASE_INSENSITIVE_FS 先例 cli-codex/index.tsx:21)
  - 2026-09-12 收口注记:3.1/3.2 全库审计未单独执行留档;UNC/远程路径消费点已在各轮按「回拼输入 root 形态」纪律落(~ 归一等,见 09 契约),后续新消费方按 09 契约自查。

## 4. 验证

- [x] 4.1 cargo:test 221 / clippy -D warnings / fmt 全绿;桩测试落 wsl_remote_ops_tests.rs + wsl_remote_tests.rs / wsl_session_store_tests.rs(live 走 env 凭据不入仓)
- [x] 4.2 前端五件套全绿(typecheck/test 1523/arch/file-size/build;多轮回归)
- [x] 4.3 验收裁决(2026-09-12 用户确认「整体功能都测试 ok」)= 远程 SSH 形态全链路真机通过(远程工作区/引擎会话/探针/历史/恢复/状态额度回填/文件树);实施中段聚焦远程形态(6-16 轮),本机 UNC 形态随 12.5 拔插桩目检 + Windows fs 原语(04 号契约),Windows 实机 UNC 单独回归未另行执行
- [x] 4.4 macOS 回归:kind 缺省路径全绿(本地会话 spawn/回放/输入闸契约测试零改动通过;分组身份补 engine 分支对纯本地会话行为不变)

## 5. 收口

- [x] 5.1 `docs/architecture/09-wsl-contract.md`:发行版建模/双通道 spawn/远程内省/分组身份/降级矩阵(含 b64 载荷与 ~ 归一纪律)
- [x] 5.2 docs/README:spec 行转「已落地」+ 新增 09 契约行;AGENTS.md 评估 = 三注册表贡献已被既有「一切贡献经 activate(ctx) 注册面」条款覆盖,不另立铁律
- [x] 5.3 提交裁决(2026-09-12 用户):整体任务单颗提交,详细 message 罗列各面(不按阶段分颗)


## 6. 远程 WSL 连接段(2026-09-11 增补,已完成)

大仙给定远程宿主(Windows + sshd 192.168.1.7:22),wsl-1 需「展开配置远程 WSL 地址/复用 ssh 配置」。裁决:主机簿复用 `settings.ssh.hosts`(CRUD/导入/凭据清洗全现成),wsl 域只存 `remoteHostId`;会话走既有 ssh 一等会话机制,PTY 内初始命令进 WSL。

- [x] 6.1 `ssh_session_create` 加 `command: Option<String>`(exec-in-pty;entry 存档,自动重连/手动重连均透传);`wsl.rs` 解析纯函数 `pub(crate)` 化共用
- [x] 6.2 新 `src-tauri/src/wsl_remote.rs`:`wsl_remote_info`(一次性 ssh exec 探测;hostkey Unknown 自动信任 TOFU、Changed 拒绝;KBI 不支持;UTF-16LE 自适应解码)
- [x] 6.3 kernel:`ipc.wslRemoteInfo`/`sshSessionCreate(…command)` 契约、`createSshSession` command 重载、`wslRemoteSpawnCommand` 纯函数(发行版名双引号防 PS 碎参)、`settings.wsl.remoteHostId`
- [x] 6.4 wsl 卡远程段(`RemoteSection.tsx`):主机下拉 + 检测发行版 + 发行版行「打开会话」;本机不可用但配了 ssh 主机时卡仍渲染
- [x] 6.5 降级(如实):远程模式 M1 仅会话 —— 无工作区建模/文件树/历史扫描/git/checkpoints(sftp UNC 可达性未验证,P2 另议)
- [x] 6.6 验证:Rust live 探针真机通过(`wsl_remote_live --ignored`,env 凭据不入仓);前端五件套绿;桩目检远程段全流程(下拉选中/探测/行渲染/打开会话携 `command:'wsl.exe -d "Ubuntu"'`)
## 7. 侧栏工作区集成 + 探针修复(2026-09-11 晚增补,已完成)

验收反馈:引擎探针在真机输出 `tMISSINGn` 乱码(根因 = 复杂引号/`$()` 脚本被宿主 PowerShell 拆坏);侧栏无 WSL 维度(wsl-2/wsl-3 原型的过滤 chips 与添加弹层 WSL tab 未落地)。本轮补齐:

- [x] 7.1 探针修复:脚本改 **b64 载荷**形态 `wsl.exe -d "D" -- bash -c "echo <b64>|base64 -d|bash"`(b64 字符集对 PS 双引号串惰性,实测全链保真);探针行协议 `bin:path`(Linux 路径约定无冒号);live 测试补端到端(claude 检出 + missing-bin 未检出)
- [x] 7.2 Workspace 加 `wsl` 元数据(`{ distro, hostId }`,Rust `WorkspaceMeta.wsl`/TS 同步,workspaces.json 持久化);`isWslWorkspace`(显式元数据或 UNC 前缀)
- [x] 7.3 添加工作区弹层双 tab(`WorkspaceAddDialog.tsx`):本地目录(系统 picker)| WSL 发行版(发行版数据源跟随 remoteHostId:远程探测/本机 wsl_info;`wsl_list_dir` 目录懒加载;落库 UNC 或 Linux 路径 + wsl 元数据)
- [x] 7.4 侧栏来源过滤 chips(全部/本地/WSL,`settings.workspaceOriginFilter` 持久)+ WorkspaceCard WSL 徽章(hover 显 distro/通道)
- [x] 7.5 远程 WSL 工作区新建会话:SessionMenu CLI 行改走 `createSshSession(…, wslRemoteSpawnCommand(distro, {cd: root, engine}))` —— 侧栏直接开出远程 WSL 会话(不再是降级挡板)
- [x] 7.6 验证:Rust(clippy/test 217/live)全绿;前端 typecheck/test 1509/arch/file-size/build 全绿;桩目检(chips 过滤/弹层 WSL tab/目录浏览/添加落库含 wsl 元数据/徽章)全通过

## 8. 验收修复轮 2(2026-09-11 深夜,已完成)

- [x] 8.1 添加工作区弹层:「添加」成功即关闭(经 onAdded 回调;本地 tab 同款)
- [x] 8.2 远程 WSL 工作区文件树 M1 显式降级:`ActiveWorkspaceFileTree` 检出 `wsl.hostId` 非空 → 渲染降级提示(根因 = 本地 fs 通道读不到远程 Linux 路径,「目录为空」+「路径必须是绝对路径」皆此症状;本机 UNC 工作区不受影响)
- [x] 8.3 新建会话菜单引擎过滤:kernel/wsl.ts 加会话内探针缓存(remember/get),DistroPanel 探测成功写入;SessionMenu 对远程 WSL 工作区按缓存过滤引擎行,未探测显示引导 note(点击行为不变,仍走 SSH 包装)
- [x] 8.4 真机验证 `wsl.exe --cd "~/.ssh"` 波浪号由 wsl.exe 自行展开(→ /home/cxn/.ssh),远程工作区 root 存 `~` 形态安全
- [x] 8.5 验证:桩目检三处全过(弹层自关/降级提示/真实探测路径驱动菜单过滤:未探测 note+全列表 → 探测后只剩 claude/omp);前端五件套绿

## 9. 验收修复轮 3(2026-09-11 深夜,已完成)

第二轮验收反馈四项:新建远程会话白屏(核心)、探针误报 Windows 侧安装、远程文件树降级挡板、侧栏过滤两排占位。

- [x] 9.1 白屏根因(真机实证):ssh exec wsl.exe 启动链发 `\x1b[6n`(CPR)后**死等应答**,而启动输入闸把 xterm 自动应答全弃 → 幕布永久空白(会话日志仅 4 字节 `\x1b[6n`;cargo live 诊断:补应答立即出提示符)。修复 = 输入闸拆两窗:重写窗(回放/翻页)全弃不变;启动 live 窗只弃用户形态输入,**放行整段终端协议回传**(isTerminalReport 匹配;拆碎片段不匹配照弃,pi-tui 拆段注入不回归;synthetic 标记保证不误开活动守望)。terminalInputGate/terminalReplay/TerminalView + 契约测试重写
- [x] 9.2 探针互操作误报:`command -v` 经 WSL 互操作 PATH 检出 Windows 侧安装(/mnt/c/.../npm/*,十个引擎九个误报)——解析层过滤 `/mnt/*` 记未检出(抽 `parse_probe_lines` + 单测;live 复测 claude=/usr/local/bin 不受影响);DistroPanel 加提示行「仅计发行版内安装」
- [x] 9.3 远程文件树落地:`FileTreeRemote.tsx` 经 `wsl_list_dir` 同一条 ssh 通道浏览所选工作区目录(跟随活动工作区 key 重挂载;自动加载根层;目录展开懒加载;文件点击/新建出 M1 提示不静默;宿主配置删除降级提示);`ActiveWorkspaceFileTree` 路由改接
- [x] 9.4 侧栏单排按钮组:「默认/本地/WSL/归档」合并为一个 radiogroup(取代 默认/归档 toggle + 全部/本地/WSL chips 两排;active 态由既有两 settings 键派生,schema 零改动;归档/默认点击重置来源维度);顺手修 WorkspaceAddDialog 重复渲染
- [x] 9.5 验证:Rust(test 219 含新单测/clippy/fmt + live 探针、live PTY 诊断真机双过);前端五件套绿;浏览器目检侧栏单排布局与 WSL 卡远程段(窄栏 230px 不换行)

## 10. 验收修复轮 4(2026-09-12 凌晨,已完成)

第三轮验收反馈两项:CLI 会话仍白屏(0:45 日志 CPR-only);远程文件列表已 ok,下一步接入本地文件渲染。

- [x] 10.1 CLI 白屏二轮根因(真机实证):live PTY 跑侧栏同款 spawn 串 `bash -lc 'claude'`,补 CPR 应答后 TUI 完整画出 —— 引擎链无恙;白屏 = **挂载竞态**:局域网连接先于幕布挂载完成,CPR 落输出缓冲走回放分支,首修只放行启动 live 窗、回放窗照吞。修复 = 闸策略化简归一:**所有闸窗(启动=回放=翻页,同一计数)只弃用户形态输入,整段终端协议回传一律放行**。代价权衡:回放历史查询的陈旧重答 = 一小段合成转义序列进活 PTY(TUI 按未知 CSI 丢弃),远小于会话挂死;synthetic 标记防误锚。armLive/liveStrict 双窗 API 回收为单计数器
- [x] 10.2 远程文件接入本地渲染:寻址层 `wslr://<hostId>/<distro>/<linuxPath>`(files 插件 remoteFileUri.ts,linuxPath 有 Rust 白名单字符集背书)→ 走既有 file tab 通道(openTab → fileCache → renderProfile),渲染规则与本地零差异;加载分支 fileCache 经新 IPC `wsl_read_file_text`(wsl_remote_ops:size 行 + base64 段行协议,b64_decode 容忍 76 列换行;超 512KB 不读、目录/不可读 exit 9 如实报错);只读收口:CodeMirror `readOnly`(kernel 编辑器加通用 readOnly prop)+ ⌘S 早退 + 状态条「远程文件 · 只读(M1)」;字节通道型渲染(图片/PDF/文档/二进制表格)显式占位不喂本地 fs;live 测试补 /etc/hostname 读取端到端
- [x] 10.3 顺手收上轮 review P2:FileTreeRemote 不再借 wsl 卡视觉类(wsl-dot/wsl-remote-err/wsl-hint → file-tree-remote-* 自有类,样式归 file-tree.css,配色同 token;臆造的 --tmd-danger 改回 --tmd-err)
- [x] 10.4 验证:Rust test 221/clippy/fmt 绿;live 三测过(探针+文件读取+PTY 诊断);前端五件套绿(test 1510);闸契约测试更新(回放窗 CPR 放行为回归锚)

## 11. 验收修复轮 5(2026-09-12,已完成)

第四轮验收反馈三项。

- [x] 11.1 WSL CLI 会话结构不一致(缺对话框):SessionMeta 增 `engine` 字段(SSH 会话专属;kind/profileId 仍为 "ssh",传输语义与 ssh 插件提示卡守望/侧栏分组不扰动),ssh_session_create/reconnect 透传;MainPanel composer 条件改为「shell 无、ssh 无 engine 则无,其余有」;composer 档案解析(useActiveProfile/QuotaChip)按 `engine ?? profileId` 取 CLI profile —— 幕布+对话框结构与本地 CLI 会话一致;SessionMenu/DistroPanel 传引擎 profile id
- [x] 11.2 omp(~/.local/bin)探不到:探针脚本 PATH 改登录 shell 语义(source ~/.profile + 补 ~/.local/bin,与引擎 spawn 的 `bash -lc` 对齐);DistroPanel 提示语同步;live 测试补 omp 断言(真机实证 `/home/cxn/.local/bin/omp` 检出)
- [x] 11.3 创建会话不替换首页:SSH 会话装配缺「活跃指针直写」(本地 CLI spawn 有、adopt 只发事件)——SshSessionService.create 成功后 `setActiveSessionId(meta.id)`,与本地 spawn 同语义
- [x] 11.4 验证:Rust test 221/clippy/fmt 绿;live 探针含 omp 登录 PATH 断言;前端五件套绿(test 1516,sshSessions 契约测试补 engineProfile 透传与激活断言)
- [x] 11.5 补:创建后仍不跳转 + 点 tab 进不去 —— setActiveSessionId 只写指针不通知,而指针已指向新会话时点 tab 被 setActiveSession 同值去重早退(一个根因两个症状)。改走公开语义 setActiveSession(指针+通知+已读+状态轮询),与 shell 服务既有「装配即激活」家规对齐(shellSessions.ts 同坑同注释先例)

## 12. 插件边界收敛(2026-09-12,已完成)

验收反馈:拔掉 wsl 插件后相关 UI 仍在(侧栏 WSL 过滤/徽章/远程文件树/添加 tab),workspace 与 files 插件硬编码 WSL 分支,耦合严重。

- [x] 12.1 三注册表协议(kernel 零来源知识,全部可退订 + React 可订阅):`ptyAdapters`(specWrapper 包装链 + 内置终端 shellSpecProvider,sessionSpawn/shellSessions 只认注册表)、`fileSources`(远程文件源:appliesTo/label/listDir/fileUri/ownsUri/readText,fileCache 与文件树路由按协议分派)、`workspaceOrigins`(过滤 chip/徽章/新建会话适配 spawnCliSession/引擎行过滤/菜单提示/添加弹层 tab)
- [x] 12.2 kernel/wsl.ts 整体迁回 plugins/wsl/wslCore.ts(含 wslr:// URI 解析与 isWslWorkspace;kernel/wsl.test.ts → wslCore.test.ts);sessionSpawn/shellSessions 的 WSL 硬包装改注册表注入;kernel 仅留 Workspace.wsl 存储字段(与 Rust WorkspaceMeta.wsl 配对,注释声明解释权归来源插件)
- [x] 12.3 workspace/files 去 WSL 化:过滤 chip 动态化(默认/本地/〈来源〉/归档)、徽章走 origin.badge、添加弹层 tab 走 origin.addTab(仅 1 tab 时收起段控)、新建会话菜单走 origin 三钩子;FileTreeRemote 通用化(FileTreeRemoteSource)、fileCache/编辑器只读守卫走 fileSources 协议;徽章样式中性化(workspace-origin-badge 归 workspace 侧)
- [x] 12.4 wsl 插件 activate 注册全部贡献(addTab 组件 = AddWslTab,自 workspace 弹层迁入)并返回退订函数;禁用插件重启不激活 = 注册表为空 = 宿主回内建形态
- [x] 12.5 验证:前端五件套绿(test 1516);浏览器双态目检 —— 启用态(chip/徽章/弹层 WSL tab/WSL 卡齐全)+ 拔插件重启态(WSL chip 消失、WSL 卡消失、添加弹层只剩本地目录)

## 13. 会话命名/历史/状态条远程区分(2026-09-12,已完成)

验收反馈三项:WSL 会话行命名是主机名、历史查询混入本机数据、composer 模型/思考/额度对远程会话显示本机数据。

- [x] 13.1 命名:SshSessionGroup 标题链与 CLI 行同构(tab 快照 > 首条消息保底 > 主机名兜底;远程会话无本机磁盘命名,promptSent 保底即主命名源),行首徽标按 SessionMeta.engine 挂引擎 icon(无引擎回退 HardDrive)
- [x] 13.2 历史区分:workspaceOrigins 协议新增 `localDiskHistory`(缺省 true = 默认本机;wsl 来源置 false);useCliSessionGroup 对远程来源工作区跳过本机磁盘扫描(活会话照常、磁盘行恒空、扫描回调即时完成防刷新按钮挂转圈)—— 本机扫描既查不到远端会话,还可能被同路径本机数据污染
- [x] 13.3 状态条远程区分:composer 工具条对远程引擎会话(kind=ssh+engine)抑制 "seeded" 本机配置种子 —— 模型/思考未观测到实况前显示「远程」(observed 实况照常显示;点击发 /model 等引擎命令照常,那是引擎语义与宿主无关);QuotaChip 远程会话不抓本机 provider,显示「额度 远程」占位
- [x] 13.4 验证:前端五件套绿(test 1516);浏览器冒烟启动渲染正常

## 14. 验收修复轮 6(2026-09-12,已完成)

第五轮验收反馈四项:重启后 WSL 会话列表空(实时启动正常 = 内存态)、未探测引擎时菜单显示不可用 CLI、对话一轮后模型/思考/额度不回填、WSL 卡「本机|远程」段控无意义。

- [x] 14.1 远程历史/状态回填断链根因:`piFamilyRemoteSessions`(list/readStatus)在轮 13 已写好但**从未接进任何 CliProfile** —— useCliSessionGroup 的远程扫描分支与 hostWatches.statusRefreshRemote 均因 `profile.remoteSessions` 缺失而走「磁盘行恒空」降级。修复 = `piFamilySessions` 返回体自动附带 `remoteSessions`(声明 remoteSessionsDirSh 即带上),omp/pi 展开点零改动生效
- [x] 14.2 远程 slug 对 `~` 形态 root 失配:AddWslTab 落库 root 为 `~/cxn` 波浪形态(wsl.exe --cd 会展开),omp 的 `$HOME` 前缀 case 与 pi 的纯 TS slug 均按字面路径算,恒找不到会话目录。修复 = 两家 remoteSessionsDirSh 脚本先归一(case `"~"|"~"/*` → `$HOME` 前缀)再算 slug;bash 模拟双形态(~/abs)输出与本地 TS slug 规则一致
- [x] 14.3 未探测引擎的菜单:filterCliProfiles 未探测态从「回退全量本机引擎」改为「空列表」,配 note 引导(文案同步去掉「当前列表为本机已知引擎」);非 WSL 工作区防御性透传(contributions.test.ts 四态回归:未探测/探测命中/探测零检出/非 WSL)
- [x] 14.4 WSL 卡「本机|远程」段控拔除:两段按可用性共存(本机段仅 wsl_info 可用时渲染,mac 直落远程段);`settings.wsl.mode` 字段退场(types/defaults/sanitize/test 同步);wsl-mode-seg 类保留(添加弹层 tab 段控共用)
- [x] 14.5 铁则收口:轮 13 遗留的超 300 行拆分 —— hostWatches 拆 identityLedger.ts(身份账本唯一写入口)+ remoteStatusRefresh.ts(远程状态观测),cli.ts 会话内省类型迁 cliSessionTypes.ts(re-export 保契约),useCliSessionGroup 扫描分支拆 useCliDiskScan.ts;顺手补远程扫描分支的「磁盘真标题喂 tab 快照」与本机分支对齐
- [x] 14.6 验证:前端五件套全绿(test 1520);远程 slug 脚本 bash -n + 双路径形态模拟;浏览器桩目检 WSL 卡(段控消失、卡头直显远程段、主机添加/探测闭环)。真机(远程历史出列表、对话后模型/思考/额度回填)待用户验收
- [x] 14.7 修正(同日):14.5 拆分时把 remoteScan 的 useMemo 丢了 —— remoteExec(workspace) 每渲染返回新闭包且在扫描 effect 依赖里,渲染一次 exec 一次 = 对远端宿主无限 ssh exec,连接洪峰把探针打成「SSH 连接失败: Disconnected」。已恢复 useMemo(依赖 origin/workspace,注册表稳定对象)并留注释;五件套复绿

## 15. 验收修复轮 7(2026-09-12,已完成)

第六轮验收反馈:远程历史出来了,但点开历史行会话,左侧列表每次多一个无名「192.168.1.7」活行,被点的磁盘行也不消失。

- [x] 15.1 根因:远程 `openRemoteDiskSession` 只开会话从不绑身份;而远程兜底绑定(statusRefreshRemote 的 createdAt ≥ spawn-5s 匹配)只对「spawn 后新落盘」的会话有效 —— resume 继续写旧文件,永远匹配不上。无绑定 = 无标题回退主机名、磁盘行不去重、远程状态也不读,且每次点击必新开。修复 = `createSshSession` 增可选 `cliSessionId`(已知身份恢复),SshSessionService 内对齐本地 openDiskSession 三件套:同引擎同身份的既有活会话去重聚焦、在途双击闸、spawn 后显式绑定(先于 setActiveSession,远程状态分派按账本直读);wsl origin 的 openRemoteDiskSession 透传 cliSessionId
- [x] 15.2 验证:sshSessions 契约测试补三态(绑定先于激活/去重聚焦不重 spawn/在途双击闸),前端五件套全绿(test 1523)。真机验收:点历史行 → 聚焦既有或新开一条带真标题的活行,磁盘行随之隐藏,模型/思考/额度对恢复会话同样回填

## 16. 验收修复轮 8(2026-09-12,已完成)

第七轮验收反馈:点历史行仍「一开多一条」,活行仍叫主机名。

- [x] 16.1 真机存储诊断(live,新增 wsl_session_store_tests.rs):`~/cxn` → slug `-cxn` 解析正确;omp resume **续写原文件不分叉**,但每次 resume touch mtime(历史行全变「刚刚」是真数据,非扫描 bug)
- [x] 16.2 真根因 = **侧栏分组身份不认 engine**:恢复会话是 `profileId:"ssh" + engine:"omp"`,而 useCliSessionGroup 按 `profileId === profile.id` 收活会话 —— 引擎会话永不进 omp 组:绑定后磁盘行不去重、标题同步永远轮空(活行恒主机名)、点开即新增。SshSessionGroup 反而把它当普通 ssh 行渲染。修复 = 分组身份统一「profileId 或 engine」:useCliSessionGroup(活会话归属)、RunningZone/PinnedSessions.liveOf/sessionOps.deleteDiskSessionFull(引擎会话同组语义)、revealSession(pin key 与运行区分支按 engine)、SshSessionGroup 反向排除带 engine 的行(归 CLI 组,不再双渲染)
- [x] 16.3 顺手:wsl_remote_tests.rs 回 300 内(诊断测试拆 wsl_session_store_tests.rs 独立模块);RunningZone 收回 300 内
- [x] 16.4 验证:前端五件套(test 1523)+ Rust test 221/clippy/fmt 全绿。真机验收预期:点历史行 → omp 组内出一条真标题活行、对应磁盘行隐藏、再点同一条 = 聚焦不新增;模型/思考/额度回填
