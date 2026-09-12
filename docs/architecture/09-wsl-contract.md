# 09 WSL 支持契约:发行版建模 / 双通道 spawn / 远程内省 / 分组身份 / 降级矩阵

日期:2026-09-12(来源:openspec/changes/wsl-workspace-m1,十六轮实施与验收;全部结论真机实证 —— 本机 UNC(Windows)与远程 SSH 宿主(Windows + OpenSSH + WSL)双形态)

## 结论

WSL 支持的全部平台知识集中在 `plugins/wsl/`(来源插件),经 kernel 三注册表向宿主贡献;内核与其余插件零 WSL 硬编码。三条铁纪律:
1. **引擎/CLI 私有知识不出各插件**:会话目录 slug、探针脚本、远程内省解析归 `cli-*` 插件;wsl 插件只提供传输通道;
2. **路径形态以落库为准,消费端归一**:远程工作区 root 是 `~` 波浪形态(AddWslTab 惯例,`wsl.exe --cd` 自行展开),一切按 cwd 推导目录的消费方(远程 slug)必须先归一 `~` 再匹配 `$HOME`,否则恒失配(2026-09-12 实证:历史/状态全空);
3. **侧栏分组身份 = `profileId 或 engine`**:远程引擎会话是 `kind:"ssh" + engine:"<cli>"`,凡按 profile 分组/去重/置顶/删除的消费方必须双认,否则引擎会话对 CLI 组隐形(同日实证:点历史行列表每击多一条无名主机名行)。

## 契约 1:发行版建模与工作区 root 形态

- Workspace 元数据 `wsl: { distro, hostId }`(kernel 只透传存储,解释权归 wsl 插件);`hostId = null` → 本机 wsl.exe,root 落 **UNC**(`\\wsl.localhost\<distro>\<posix路径>`,Win11 `wsl.localhost` 与老 `wsl$` 两种前缀都认);`hostId` 非空 → 远程宿主,root 落 **Linux posix 路径(`~` 波浪形态)**。
- settings 只存 `wsl.remoteHostId`,主机簿复用 `settings.ssh.hosts`(CRUD/凭据清洗现成,不另设账户域)。
- 回归锚点:`wslCore.test.ts`(UNC 解析双前缀 / 波浪归一)。

## 契约 2:双通道 spawn 包装

- 本机 UNC:ptyAdapters 注册表注入 `wrapWslSpec` —— `wsl.exe -d <distro> --cd <linuxPath> -- bash -lc '<cmd>'`,进程 cwd 落 Windows home(UNC cwd 在发行版停止时 CreateProcess 失败);内置终端直落 `bash -il`。
- 远程:`createSshSession(host, wsId, command, engineProfileId, cliSessionId?)`,command = `wsl.exe -d "<distro>" --cd "<path>" -- bash -lc '<engine>'`,作为 ssh 会话 PTY 内首命令;发行版名/路径双引号包裹(宿主 DefaultShell 可能是 PowerShell:单引号串=字面量,复杂脚本必须走 b64 载荷,见契约 4)。
- 引擎档案 id 随 `SessionMeta.engine` 透传(composer/侧栏按 engine 取 CLI profile,kind 仍为 "ssh",传输语义不扰动)。
- CPR 纪律:ssh exec wsl.exe 启动链发 `\x1b[6n` 死等应答,输入闸所有闸窗只弃用户形态输入、终端协议回传整段放行(详见 04 号契约 1 与 terminalInputGate 契约测试)。

## 契约 3:b64 载荷传输(一切远程脚本)

宿主 PowerShell 会拆坏命令行里的引号/`$()`,**任何远程脚本必须**经 `wsl_bash_payload`:`wsl.exe -d "<d>" -- bash -c "echo <b64>|base64 -d|bash"`。b64 标准字符集对 PS 双引号串惰性,全链保真(直排脚本实证必碎)。`wsl_exec` 非零退出不报错(grep 无匹配/目录为空 = 空数据),wsl.exe 输出自适应 UTF-16LE 解码。

## 契约 4:引擎探针

`wsl_probe_engines` 按 CLI profile 的 command 清单逐 bin 探测;脚本 = 登录 shell 语义(`source ~/.profile` + 补 `~/.local/bin`,与 spawn 的 `bash -lc` PATH 对齐);行协议 `bin:path`,解析层过滤 `/mnt/*`(Windows 互操作 PATH 检出 = 未检出,十个引擎九个误报的教训)。探测成功写会话内缓存(`rememberWslProbes`,按 distro 键),新建会话菜单按缓存过滤引擎行 —— **未探测 = 空列表 + 引导 note**(不显示不可用 CLI);缓存随重启清空,重探测才恢复。

## 契约 5:远程会话内省(remoteSessions)

- 协议:`CliProfile.remoteSessions { list(exec, cwd), readStatus?(exec, cwd, id) }`,exec 由来源提供(`workspaceOrigins.remoteExec` → `wsl_exec`);pi 族共享实现在 `cli-shared/piFamily.ts`(`piFamilySessions` 声明 `remoteSessionsDirSh` 即自动附带 remoteSessions)。
- list:一次 exec 列目录头(名字/mtime/头 32KB b64),解析身份行与标题;readStatus:尾窗 256KB。
- **slug 必须先归一 `~`**:`case "$c" in "~"|"~"/*) c="$HOME${c#"~"}" ;; esac` 后再走 `$HOME` 前缀匹配/TS 同规 slug(契约 2 的 root 形态决定这是常态路径,不是边角)。
- 状态观测分派(hostWatches → remoteStatusRefresh):有来源 remoteExec + 引擎 remoteSessions → 走远端磁盘通道;本机身份探测对远程天然失效,**绑定两路**:① 已知身份(点历史行恢复)显式绑定 —— `createSshSession` 第 5 参携 cliSessionId,服务内对齐本地 openDiskSession 三件套(既有活会话去重聚焦 / 在途双击闸 / spawn 后绑定先于激活);② 全新会话按「文件 createdAt ≥ spawn-5s 最早条目」启发式(resume 旧文件匹配不上,必须走①)。绑定是标题回填、磁盘行去重、模型/思考观测、额度(账号级 HTTP 按 model 查)的共同前置。

## 契约 6:侧栏分组身份(见结论 3)

- `useCliSessionGroup` 活会话归属:`profileId === profile.id || engine === profile.id`;`SshSessionGroup` 反向排除带 engine 的行(纯 SSH 终端专属,防双渲染);RunningZone profile 查找、PinnedSessions.liveOf、sessionOps 删盘 kill 路径、revealSession(pin key = `engine ?? profileId`、运行区分支)同口径。
- 远程磁盘行恢复的带宽纪律:list 按目录头浅窗(32KB/文件)、mtime 倒序截前 50;omp resume 续写原文件并 touch mtime(历史行「刚刚」是真数据),不 fork 新 id。

## 契约 7:文件通道(M1 只读)

- 浏览:`fileSources` 协议 `listDir` → `wsl_list_dir`(同一条 ssh 通道);寻址 `wslr://<hostId>/<distro>/<linuxPath>`;读取 `wsl_read_file_text`(size 行 + b64 段行协议,容忍 76 列换行;超 512KB 不读、目录/不可读 exit 9 如实报错),渲染与本地零差异,CodeMirror readOnly + ⌘S 早退。

## 降级矩阵(M1 边界)

| 能力 | 本机 UNC | 远程 SSH |
|---|---|---|
| 引擎会话(spawn/resume/状态/额度) | 全量 | 全量 |
| 磁盘历史扫描/恢复 | 本机 fs | remoteSessions 通道 |
| 文件树/预览 | fs 直读 | wsl_list_dir + wslr:// 只读 |
| git 面板 / checkpoints | 按 kind 置灰 / 降级 | 同左(降级提示,不静默) |
| 写回(编辑/新建/删除) | fs 原语 | M1 不做(只读) |

拔出 wsl 插件(重启生效)= 三注册表为空 = 侧栏 chip/徽章/弹层 tab/WSL 卡全部消失,宿主回内建形态。
