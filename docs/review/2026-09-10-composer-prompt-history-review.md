# Composer 输入历史落地自评审

- 日期:2026-09-10
- 状态:已完成(发现 2 个 P2 当场修复;P3 缓修 3 项已记录)
- 评审对象:commit 431e0dd(feat(composer): 输入历史——Tab 补全、空输入召回与设置管理区)

## 结论

功能实现与 codemoss 参考实现逻辑等价,架构合规(R1/R3/R4、300 行铁则、kernel 准入成立),交互矩阵桩目检全部通过。评审发现 2 个 P2(ghost 长文本错位、ghost 与下拉并存)当场修复,3 个 P3 缓修记录在案。

## 方法

1. 重读 431e0dd 全量 diff,逐文件对照实现期设计(docs/brainstorm/2026-09-10-composer-prompt-history.md);
2. 1421 vite 桩目检交互矩阵(ghost 显隐/Tab 接受/召回全序/发送入史/管理区增删清/关闭态回落);
3. 全套验证:typecheck + 177 文件 1380 测试 + arch-boundary + file-size + build + react-doctor 100。

## 发现

### 已修(评审当场)

1. **P2 ghost 长文本换行错位**(Composer.tsx textarea className)
   - 现象:global.css 全局滚动条为 4px 常驻轨道;textarea 内容溢出出现滚动条时,其内容宽度比镜像层(overflow-hidden,无 gutter)窄 4px,两侧行宽不一致导致 ghost 续写文本在词边界错位。
   - 修复:composer textarea 加 `[scrollbar-width:none] [&::-webkit-scrollbar]:w-0`(聊天输入框惯例),滚动条永不占位,滚轮/触控板滚动保留,两侧行宽恒等。

2. **P2 ghost 与触发符下拉并存**(Composer.tsx 镜像层渲染条件)
   - 现象:历史条目以 `/` `@` `$` 开头时,输入触发符会同时弹出下拉与 ghost 续写;Tab 优先归下拉(判定顺序正确)但视觉上出现双建议。
   - 修复:镜像层渲染加 `!matches` 闸——下拉打开期间不画 ghost,关闭后恢复。

### 缓修(P3,记录在案)

3. **kernel/promptHistory.getPromptHistory() 返回活引用**:现有消费方全部只读(召回按下标读、管理区 map 出副本再排序),无实际风险;若未来外传建议改为返回副本或冻结。
4. **useComposerSend 命名**:内部无 hook,实为闭包工厂,`use` 前缀可能诱发未来 react-hooks lint 误报;现 react-doctor 100,改名收益低,缓。
5. **phosphor 图标 deprecated hint**(CaretDown/CaretRight/Trash/X):与全库既有图标用法同款,tsc 不阻塞,待全库统一升级图标面时一并处理。

### 已知取舍(非缺陷,实现时已裁决)

- 手动键入的 `/` 斜杠命令也入史(codemoss 同款语义);⌘K 抽屉/工具栏命令发送不入(按钮路径无输入框)。
- 召回导航中途失焦(点幕布)再回不重置游标,继续 shell 风格翻阅;提交入史时统一重置。
- 历史存 localStorage(单机应用,与置顶/归档覆盖层同级;无跨窗口同步需求)。

## 事故记录(实现期抓到,已含于 431e0dd)

React 合成事件 `{...e}` 展开会丢失原型方法:`preventDefault is not a function` 导致 ↑ 召回静默失效(↓ 因提前 return 未触雷,恰好造成单键不对称假象)。修复:跨 handler 传事件面一律 `e.nativeEvent`(原生事件自带 key/modifiers/isComposing/preventDefault)。

## 核对矩阵(通过项)

| 维度 | 证据 |
|---|---|
| 功能等价 | 去重置底/200 封顶/300 截断/计数排序/前缀匹配(大小写不敏感)与 codemoss prompt-history 逐条对照 |
| 判定顺序 | keydown 契约扩为 IME → 下拉 → ghost Tab → 历史召回 → 非空/移交;arrowIntent.ts 零改动,原五行单测原样通过 |
| IME 安全 | 组合期传 "" 禁 ghost、nav 有 isComposing 守卫、Enter 交还输入法 |
| settings 兼容 | promptHistoryEnabled 缺省 true,sanitize 白名单化,旧 settings.json 无字段回落默认 |
| 架构 | kernel/promptHistory 为 composer+settings 双消费通用原语(循 composerStage 先例);R1/R3/R4 全过;Composer 299 行;无新增 IPC/Rust |
| 性能 | 补全防抖 100ms + ≤200 条线性扫描;record 同步写 localStorage(单条 JSON <10KB);无新增热点 |
| 验证 | 1380 测试全绿;typecheck/boundary/file-size/build/react-doctor 100;桩目检矩阵全过 |

## 遗留

- 真机 tauri:dev 手感目检(gst 错位修复后的长文本 ghost 对齐)由用户日常使用确认;
- P3 三项随下次触达对应文件时顺手处理,不单开任务。
