# 任务:0.4.0 向内治理批八项

状态:全部完成(2026-10-18,八路并行实施+集成收口;验证口径见 proposal.md「验证」节)。

- [x] 1 保留律收尾:sessionKeep 容量 2000;scanAndSweep 核心抽取;hygieneBootSweep 45s 一次性(远程跳过/前台让路/串行)
- [x] 2 冻结快照:terminalFreeze LRU8 四闸裁决;terminalCanvasHealth.settleTerminalFreeze 卸载两用;terminalReplay 快路径
- [x] 3 通知中心:notify-log.json 流水;NotifyCenterPanel 右栏;kernel/dnd 三闸;设置页免打扰卡
- [x] 4 会话预设:kernel/sessionPending 上移;sessionPresets 存储;presetLaunch 两步编排;SessionMenuPresets+SessionPresetsDialog+PresetFormCard
- [x] 5 检索增强:searchSessions 时间谓词;SearchOverlay 时间 chip;openHit 走 openThenJumpToText
- [x] 6 存储管家:Rust fs_dir_usage(20s 超时分桶);storage-audit 插件(体检表+prune+docgen 归档清理);ipc.fsDirUsage+权限表
- [x] 7 转录导出:blocksToMarkdown;viewerTab 导出钮;docgen safeFileBase 共享导出
- [x] 8 互跳:kernel anchorJump 文本跳转契约;turnMatch 正向匹配;TurnFilesChip;BatchSheet「看对话」
- [x] 集成:toggleGroup 语义回归;词典裸键/双引号修复;六处同键异值对齐;react-doctor 重构到 100;六处版本源 0.4.0;CHANGELOG/architecture 27/登记
