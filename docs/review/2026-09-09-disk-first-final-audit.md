# 磁盘先行回放整体任务终审(已提交区间全量)

日期:2026-09-09 · 评审人:reviewer 子代理(24min 深读)+ 主会话并行自查 · 对象:工作区磁盘占用治理任务链全部落地产物(代码 165b4d4/966271a/848ee7b + 文档 c86f2b6/d3fe8ee,1224 行 diff,44 文件)

## 结论

初判 BLOCK(4×P1 + 7×P2),**当日全部修复并提交**(修复批 `8edf7e3`,rebase 后 `beb927a`;P1-1 历史手术见下)。干净维度:红线纪律(磁盘字节全链路绕过 appendOutput,测试断言零调用)、Rust 读尾(TOCTOU 降级/clamp/静默失败面)、自动激活拆除完整性、300 行铁则。

## 发现与处置

| 级别 | 发现 | 处置 |
|---|---|---|
| P1-1 | 165b4d4 扫入并行会话 cli-config 的 registerCliConfig 两 hunk(cliConfigRegistry.ts 9e71b42 才入树),提交独立 typecheck 必挂,bisect 断链 | rebase 双停手术:165b4d4→9e49ffd 删两行并当场 typecheck 独立通过;hunks 移交 9e71b42→8f94258;最终树哈希与手术前逐位一致(fbf6d9e0),零内容漂移 |
| P1-2 | askProbe 停采挂在 loadProgress(遮罩态)而非 ready,磁盘有尾分支攒队期(≤30s)墓碑帧进 askWatch 屏幕通道,写后闸可被架空(假 waiting+提示音) | 停采判据改 ready 相位:terminalReplay 增 onReady 回调,TerminalView 以 readyRef 读相位 |
| P1-3 | diskTail.then 缺就绪守卫:CLR 在 promise 未决期到达 → finishDisk 先就绪,resolve 后墓碑帧盖活帧 + 输入闸重 arm 冻 30s | .then 开头 cancelled‖ready 守卫:整体作废墓碑帧/撤罩/Ask 恢复 |
| P1-4 | 写后闸测试全在无闸 restoreTail 上,带闸 restoreDiskTail 零覆盖(删掉修复测试照样绿) | 测试文件重写直打 restoreDiskTail:8s 闸内不升级/闸过期升级/移除清理 |
| P2-1 | CLR 跨事件分裂漏检(PTY 8ms/1MB 批次只拼 UTF-8 不拼转义) | 攒队滚动 8 字节窗拼接后扫描 |
| P1-5(自查) | 12s 全局 failsafe 永假(diskTail 恒为 Promise),内存回放分支失去防卡罩兜底;新会话 consumeDiskTail 可为 null 被 .then 直崩 | 恢复三路结构:磁盘先行/首开无尾/内存缓冲;failsafe 归位内存与无尾两路 |
| P1-6(自查) | 墓碑帧分支 release 挪入 finishDisk 且 cancelled 提前返回 → 回放中途卸载输入闸永久 arm,tab 键盘失灵 | 回放尽即 release(spec 口径),竞态/卸载路径零泄漏,新增回归测试 |
| P2-2 | diskFlushTimer 覆盖前未 clearTimeout | 已补 |
| P2-3 | onBound 额外 noteLogBinding 与 bindIdentity 重复且绑失败也写指针;lastWriteAt 不随会话移除清理 | 唯一写入口收口 bindIdentity/track;onSessionRemoved 补清 |
| P2-4 | project_slug 不拒裸 `..`(profile/cwd 组件) | log_dir 收口校验 + Rust 测试 |
| P2-5 | CLR 早于决议竞态/跨事件分裂测试盲区 | 补三用例(分裂窗/竞态盖帧/卸载闸泄漏),14/14 绿 |
| P2-6 | TerminalView.tsx 299/300 零余量 | 修复顺带净减 1 行(298,拆出 TerminalViewExtra 留待下次净增) |
| P2-7 | AGENTS §0.4 architecture 沉淀缺位 | docs/architecture/06-disk-first-session-open.md 落盘 |

## 验证

修复后:前端 typecheck + 1309 测试全绿;Rust 190 绿(session_disk_log 8/8 含新增 dotdot 拒绝);clippy -D warnings / fmt / arch / file-size 全过;rebase 终态树哈希 fbf6d9e0 与术前一致;9e49ffd 单独 typecheck 通过(P1-1 修复证据)。

## 教训(写入长期记忆)

1. 手术式暂存不能止步文件级——`git diff --cached` 逐 hunk 对照「这行是不是我的」,文件级干净 ≠ 文件内干净(P1-1 根因)。
2. 防御性状态机(布尔相位)在异步接缝下互相埋雷,相位机要画在纸上再审一遍 promise 未决期窗口(P1-3/自查两条同根)。
3. 闸类资源(输入闸/抑制窗)的释放必须挂在「开始-结束」原语对内,不能挂在下游完成回调里。
