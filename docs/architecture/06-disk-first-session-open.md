# 06 磁盘先行回放:会话打开零预付进程

日期:2026-09-09(内存根因治理主线,spec 2026-09-09-disk-first-session-open-design,同日落地)

## 结论

点开磁盘会话的默认路径:**Rust 指针文件寻址上一代 PTY 日志 → 尾部回放出墓碑帧 → resume 进程后台拉起 → 攒活流直到攒队出现 `\x1b[2J`(终端协议层 TUI 全屏重绘通用前奏)后 300ms 一次 flush 无缝切换**。秒开是所有磁盘会话的默认路径而非预购特权;0.1.3 的「启动自动激活最近会话」(预开 16 个真实进程,实测 4.9GB 常驻)整体拆除。冷启整树 ≈0.5GB,22 分钟实开 8 会话整树 2.15GB,WebContent 1.4GB→330MB(对照旧架构 3h 6.7GB→11.86GB 轨迹)。

## 契约

- **指针寻址**:PTY 日志按 spawn 代 uuid 命名,跨代靠 `session-last-log.txt` 指针(`session_link_log` 写 / `session_disk_tail` 读,profile+cwd+cliSessionId 寻址,分隔符与裸 `..` 拒绝);写入口唯一 = 身份绑定(identityWatch.track / bindIdentity),读 = `diskReplay.ts` 单槽预取(openDiskSession 同步发,挂载消费,身份错配即弃)。无指针(首开/外部会话)→ 无墓碑帧变体:连接遮罩保持到首帧。
- **冷开切换三段式**(terminalReplay):①就绪锁未解除 → 活流攒队不直写(防启动清屏擦白屏);②攒队滚动 8 字节窗含 `\x1b[2J` → 300ms 后一次 flush(吞掉清屏,擦的是墓碑帧,清屏与同帧内容同批抵达);③30s 兜底覆盖纯文本 CLI。CLR 到达早于磁盘 promise 决议 → 墓碑帧与 Ask 恢复整体作废(就绪守卫,防盖活帧)。
- **就绪相位即采样相位**:askProbe 在 ready 前停采(墓碑帧不进 askWatch 屏幕通道);输入闸回放尽即释放,卸载/竞态路径零泄漏。
- **Ask 磁盘恢复**:墓碑帧尾部带「按 y / Enter 确认」标记 → 就绪时 `restoreDiskTail` 恢复等待徽章(自带 8s 写后闸,回放窗内作答不翻旧账);`restoreTail` 无闸,仅 bootAskRestore/内存回放观察用。
- **红线**:磁盘回放字节**永不进 appendOutput** 守望主链路(误开轮/误未读/误升级/误文件变更);回放渲染是纯 xterm 写,零引擎适配,新增 CLI 引擎改动面不变(插件目录 + allPlugins 一行)。
- 进程数 = 用户实际点开的会话数,零预付;关 tab 不杀会话(后台任务保护)、退出 `kill_all` 清场(自动激活遗产,保留)。

## 关键文件

- `src/kernel/terminalReplay.ts` —— 三段式冷开编排(磁盘先行/首开无尾/内存回放三路)
- `src/kernel/diskReplay.ts` —— 单槽预取件
- `src/kernel/askWatchFeed.ts` —— `restoreDiskTail`(带 8s 写后闸)
- `src/kernel/sessionSpawn.ts` —— open 时同步预取(`prefetchDiskTail`)
- `src/kernel/identityWatch.ts` / `hostWatches.ts` —— 指针写唯一入口
- `src-tauri/src/session_disk_log.rs` —— `session_link_log` / `session_disk_tail`
