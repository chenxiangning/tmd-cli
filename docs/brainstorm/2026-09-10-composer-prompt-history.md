# Composer 输入历史(召回 + ghost 补全 + 管理区)—— 需求澄清

日期:2026-09-10
状态:已收敛(当日实施)

## 用户原始诉求

参考 codemoss(~/code/AI/github/codemoss,即 desktop-cc-gui / ccgui-next)给 tmd-cli 加「输入历史」功能,以截图为交互基准:

1. 「历史输入补全」开关 —— 输入时按 Tab 接受历史补全建议;输入框为空时按 ↑↓ 翻阅历史;
2. 「输入历史」管理区 —— 折叠列表(管理历史记录 (N))+ 逐条删除 + 清空全部;
3. 截图中的「发送消息快捷键」tmd-cli 已有(行为页 segmented),不动。

## 参考实现取证(codemoss 只读扫描)

- 数据面:`src/features/chat/prompt-history.ts` —— localStorage 双 key(items/counts),上限 200 条 / 300 字,记录去重置底(newest-last),按使用次数排序选最佳 ghost 候选(次数同则取更短)。
- 交互面:`src/components/application/ai-chat/use-prompt-history.ts` —— ghost 防抖 100ms、IME 组合期不显示、最短 2 字符;↑↓ 召回为 shell 风格(空输入 ↑ 起翻,↓ 越过最新恢复草稿,任意其他键退出不消费)。
- ghost 呈现:contenteditable `::after` 伪元素(attr(data-completion-suffix)),不入 DOM。
- 设置面:`PromptHistorySettings.tsx` —— 开关行 + 折叠管理区 + 红色清空全部(ConfirmDialog)。

## 决策与取舍

| 问题 | 决策 | 理由 |
|---|---|---|
| 开关存储 | settings schema 新字段 `promptHistoryEnabled`(默认开) | 与 sendShortcut/askSoundEnabled 同类的行为偏好,进 settings 才能走统一清洗/持久化/设置页 |
| 条目存储 | localStorage 单 key `tmd.composer.promptHistory.v1`(`{items,counts}`) | 批量数据循 filePanel/sidebarActions「纯 UI 态不进 settings schema」惯例;单 key 比双 key 少一半读写与校验 |
| ghost 呈现 | textarea 镜像层(absolute overlay,同字体/内边距,value 透明 + suffix 弱色) | tmd-cli 是 textarea 不是 contenteditable,`::after` 不可用;镜像层是 textarea 内联补全的标准做法。仅光标在末尾时显示(中途编辑无 ghost),scroll 同步 |
| 召回契约 | 空输入 ↑ 起翻(有历史且开启时);判定顺序 IME → 下拉 → 历史 → 移交幕布 | 截图文案即此语义;nav hook 先消费、消费不了才落回 `resolveArrowIntent`,**arrowIntent.ts 零改动**,现有五行契约测试不动 |
| Tab 归属 | 下拉打开时 Tab 仍归下拉(选中候选);仅无下拉时 Tab 接受 ghost | 既有判定顺序契约(openspec design §6)优先级不变 |
| 记录范围 | 仅 Composer `sendCurrent` 自然语言发送(trim 非空即记,不开轮闸不拦) | 抽屉/工具栏命令 ⌘K 一键可达,无召回价值;promptGate 轮次闸语义是锚点批次,与历史无关,不混用 |
| 设置 UI | 行为 tab segmented 开关行(全页既有控件)+ 管理区拆 `PromptHistoryManager.tsx` | segmented 与全页一致;BehaviorTab 已 228 行,管理区独立成文件防 300 行铁则 |
| 清空确认 | 两步 armed 按钮(点一次变「确认清空?」) | 循 SessionContextMenu armed 先例,无新弹窗组件 |

## 契约落点

- 判定顺序注释更新在 `Composer.tsx` keydown 头注释(IME → 下拉 → 历史/移交 → 发送)。
- store 契约(上限/排序/去重)注释在 `src/plugins/composer/state/promptHistory.ts` 头部。
- composer 插件内建能力,不新增 kernel 面、不新增 IPC。

## 验证口径

- 单测:store 纯逻辑(记录去重/封顶/计数/删除/清空/最佳候选排序)。
- 桩目检:1421 dev server 真实页面驱 ghost 显示/Tab 接受/↑↓ 召回/开关生效/管理区增删清。
- 全套:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`。
