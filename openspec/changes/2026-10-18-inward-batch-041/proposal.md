# 提案:0.4.0 向内治理批八项(保留律收尾 / 冻结快照 / 通知中心 / 会话预设 / 检索增强 / 存储管家 / 转录导出 / 互跳)

日期:2026-10-18 · 状态:已落地(全量实施+集成收口,本文为事后补录的变更契约)

## 背景与目标

0.3.9 七候选(向外对齐)落地后,换「向内治理」角度再规划一批:多开会、长周期使用之后的八个面——时间(会话堆积)、内存(幕布常驻)、通知(看完即逝)、效率(重复起会话)、找回(检索最后一公里)、磁盘(无人盘点)、带走(转录导出)、粘合(checkpoint↔对话)。视觉示例与代码级可行性见 `docs/design/041-candidates/`(深化 v2,全部结论带 path:line 锚点);架构契约沉淀见 `docs/architecture/27-041-candidates-contracts.md`。

## 方案取舍

- **敏感信息守门(原候选 4)撤下**(大仙拍板),不借机翻案;助手消息入索引移出(需新解析器族+索引缓存版本戳,超开关成本);全局命令面板不投(⌘K 被 composer 占用、global 注册表已有两个消费面,弱缺口)。
- **候选 1 深化发现已落地**(sessionSweep):改为收尾两个缺口——keep 容量 2000、启动补扫(一次性、仅本地、有意串行,零轮询不新增触发面)。
- **候选 2 收窄**:只优化「挤除后重开且内存缓冲仍在」路径,四闸防错认(指纹/字节/字符/头样本),宁慢不错;磁盘重开路径不动。
- **pending 队列上移 kernel**(anim+workspace ≥2 消费,契约准入成立);提示词引用存三元组而非 id(assets 提示词无 id,不造第二身份体系)。
- **检索助手索引入索引不做**;时间过滤纯检索期谓词(索引零改动);定位走 kernel 时序桥单点(session-search/checkpoints 共用)。
- **存储清理面全走白名单+现成命令**(checkpoint_prune/删除归档版本),CLI 会话目录只读零触碰;Rust 新命令 skip 参数化(不硬编码 .git,checkpoints objects.git 必须计入)。

## 验证

- `pnpm check:gate` 全链绿(file-size/arch-boundary/i18n 0 缺 0 不对称/kernel-audit/tsc/4167 tests/build)。
- `cargo test` 360 过、`clippy -D warnings` 净、`fmt --check` 净;`npx react-doctor -y` 100/100。
- 八路 worker 各自 targeted vitest(共 60+ 新用例:freeze 13/notify dnd+log 20+/presets 契约+store/search 谓词+叠加/storage 6/export 9/cplink 98 内含/retention 8)。
- 集成裁决记录:toggleGroup 语义回归;词典裸键加引号(checker 只认带引号键);六处跨插件同键异值对齐先注册值;`fsDirUsage` 入 IPC 权限表;`loadSessionPresets` 全错吞为空库(contract 测试无 Tauri 环境)。
- 桩目检(1421)待补:通知中心面板/预设菜单与编辑器/检索时间 chip+跳转/存储体检区/导出钮/时间线 chip。

## 任务

- [x] 候选1:keep 容量 2000 + 启动补扫
- [x] 候选2:挤除冻结快照
- [x] 候选3:通知中心(流水+面板+免打扰三闸)
- [x] 候选4:会话预设(kernel sessionPending 上移+存储+菜单+编辑器)
- [x] 候选5:检索增强(时间谓词+chip+行级定位)
- [x] 候选6:存储管家(Rust fs_dir_usage+storage-audit 插件)
- [x] 候选7:转录导出(blocksToMarkdown+工具行)
- [x] 候选8:checkpoint↔转录互跳(正向 chip+反向看对话)
- [x] 集成收口:gate/Rust 套件/react-doctor/版本六源 0.4.0/CHANGELOG/architecture 27
