# 提案:0.4.0 批次混合批(终端路径点击 / 跨工作区检索 / 历史修复+抽屉 / checkpoint 恢复预览 / 额度告警增量 + 债收尾)

日期:2026-10-18 · 状态:已拍板待实施(大仙 2026-10-18 从 042 示例组八项裁选 1/3/4/6/7,2/5/8 删除不翻案;当日裁定本批计入 0.4.0,不再单开 0.4.1)

## 背景与目标

0.4.0 向内治理批已收口(tag 未打),本批随 0.4.0 发版,不单独定号。混合版(沿 0.3.9 先例,大仙拍板):债收尾批固定 + 新特性五项。候选来自七路并行 scout 缺口盘点(约 50 条提级 20 进菜单,全文池 `docs/brainstorm/2026-10-18-042-next-steps.md`);示例组 `docs/design/042-candidates/` 目检后拍板;五项推演定稿(现状核实+契约+边界矩阵+裁决含被否方案+验证口径+实现步序)见 `docs/design/042-candidates/feasibility.md`。

## 方案取舍

- **项1 路径点击(S)**:provider 落 files 插件循 marks 先例,kernel 注册表零改动;`openFileAtLine` 原语现成。cwd=spawn 时值不追踪 cd(OSC 7 被否:多平台差异 S 项装不下,天花板文档化);区外/不存在静默(循 marks);col 忽略只跳行;无设置键。
- **项3 跨工作区检索(M)**:缓存=路径唯一 key+cwd 命名空间留存+全局 LRU 3000(否纯 LRU——会把本区热缓存挤光回到互踢,否 Map-of-Maps——纯增结构);**先切工作区后跳**(否直接跳——降级时上下文错位);失效区命中不可跳(跳了 workspaceId 空,侧栏永不可见);indexerTicks 加 12ms 时间盒排空(否则全部态暖缓存分钟级);`indexer.ts` 已 279 行,先拆 `searchCore.ts`(300 铁则)。
- **项4 历史修复+抽屉(S-M)**:存储全文,300 截断语义降级为 ghost 匹配/展示窗口;总量字节封顶 512KB 最旧淘汰;抽屉 **Cmd+L**(全库零命中;否输入触发符/⌘Y/⌘K 加分区);Composer 局部 state 不进 drawerOpen 三态机;回填整替草稿不直发;存量截断条目不打标(假阳性);time/engine/ws 药丸无数据源本版不做(schema v2 后置)。
- **项6 恢复预览(M)**:抽 `plan_restore` 纯函数复用 restore_batch 阶段一(否复制版——skip 语义两处必漂移);新命令 `checkpoint_restore_preview` = plan + blob_patch(live,target);覆盖判定=账本 untouched/surgical(否设计页 git status ∩——会把本会话自己刚写的未提交改动全员误标,恐吓化);undo_revert 复用 revert 预览不新发 dry-run(guard 信息增量≈0);弹层内冻结预览,IPC 失败回落文案不阻塞确认;E_Empty 前端分支为中性提示实现免弹。
- **项7 额度告警(S)**:推演发现告警主体 0.2.8 已落地(8c08a44f 轮询链+阈值键+通知流水),收窄为**增量三腿**——①余额绝对阈值(balanceValue 仅 deepseek/relay 透传可得;否百分比——无额度分母属发明数据);②claude 窗口腿(quotaWindow 迁 cli-shared 纯 cutover,notify 侧尾读推算;否挂 welcome 聚合——跨插件反向依赖破铁律);③去重持久化(扩 notify-log.json 头部 quotaSeen,否新状态文件——多一个生命周期要管)。顺手修现存真 bug:quota 分支绕过 shouldNotify,免打扰窗不拦 OS 通知。凭据懒刷新挂点被否(不看首页=永不告警,离开工位主场景失效)。
- **随手带四项随批**:搜索浮层 Aa/.\* toggle+n/m 计数、检索多命中计数+展开子命中、⌘+/⌘-/⌘0 字号缩放(写回 terminalFontSize)、anim Windows `explorer /select` reveal(0.3.9 非 mac 隐藏口径随之修订)。
- **债收尾批固定**:workbench 空壳批量归档工具(照已立项 spec `2026-10-17-workbench-shell-archive-design.md` 实现)+ 真机验收债 AI 陪跑(mobile M2 余 6 项 + 0.3.5×14 + 0.3.7×6 + anim 真窗口 + M9 失败 pill);signing-pipeline 继续挂起(卡 secrets/证书)。
- **落选不翻案**:#2 codex/qoder 懒自算标题、#5 viewer 会话内查找、#8 设置导出/导入(042 组页已删);被裁 8 项与不做清单沿用 041 边界。

## 验证(计划)

- `pnpm check:gate` 全链绿(与 CI 前端 job 同链同序);动过 `t("…")` 处重点核对 i18n 缺键/不对称/死键三段;kernel 分区盘点无迁出红线。
- Rust(项 6/7 触及):`cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`。
- 新增单测覆盖各裁决点:路径正则矩阵/缓存命名空间剪枝+LRU/字节封顶淘汰/ghost 窗口截断/plan_restore(交集/空集/skip)/阈值比较+quotaSeen 去重/minimax 口径断言。
- `npx react-doctor@latest -y` = 100(提交收口铁则);推送前最新树再跑 gate。
- 1421 桩目检五项主流程+边界态;真机项随债批陪跑登记。

## 任务

- [ ] 项1:files 插件 terminalPathLinks(provider+注册+正则矩阵测试+cwd 天花板注释)
- [ ] 项3:searchCore.ts 拆分 + indexer cwds[]/per-entry workspaceId/进度字段 + indexerTicks 时间盒 + SearchOverlay scope chip+先切后跳
- [ ] 项4:promptHistory 全文存储+512KB 封顶 + ghost 窗口语义 + HistoryDrawer(Cmd+L) + composer.toggleHistory 命令
- [ ] 项6:plan_restore 抽取 + checkpoint_restore_preview 三处登记 + ConfirmCard 预览表(fileChipCls+覆盖本地药丸) + undo 对称 + 免弹分支
- [ ] 项7:balanceValue 两家透传 + quotaWindow 迁 cli-shared + quotaWatch 两腿 + notify-log quotaSeen + dnd 三闸修复 + NotifySettingsTab 两键
- [ ] 随手带:搜索 Aa/.\*+计数 / 检索多命中展开 / ⌘± 字号 / anim Windows reveal
- [ ] 债批:workbench 空壳归档工具(照 spec 实现)
- [ ] 集成收口:gate/Rust 套件/react-doctor/CHANGELOG 0.4.0 小节增录/架构契约沉淀/桩目检(版本六源已收口在 0.4.0,本批无需再 bump)
- [ ] 真机验收债陪跑(随大仙节奏逐项登记过/挂)
