# 工作区会话列表扁平化视觉重构设计

- 日期:2026-09-08
- 状态:已确认(用户看完原型后拍板方案 A,指令:「大道至简 就用A」「cli 分组前端隐藏,只把视觉层级改了」「会话管理放在工作区的文件夹头上,归档同理」「别的元素不要改」)

## 背景与目标

用户痛点(聊天截图原话):

1. 对话标题比上级分组标题大还高亮 —— 层级倒挂(行 0.875rem/text-strong vs 分组段头 0.625rem uppercase text-faint)。
2. 同级对话有的高亮有的灰、高亮字体还大 —— live 行 0.875rem 常规体 vs 磁盘行 0.75rem 等宽 muted,两种行形同列表混排,扫读困难。
3. 不同供应商对话没必要分组 —— 要求按时间平铺、行首加供应商 icon(AIchat 式),少一个模型类型分组层级。

目标:工作区会话列表视觉层级收敛为「工作区 → 会话」两层;行形统一;选中态唯一高亮;数据流与分组装配逻辑不动(纯前端视觉层级调整)。

## 方案取舍

| 方案 | 内容 | 取舍 |
|---|---|---|
| **A · 扁平时间序(选定)** | 隐藏 CLI/终端/SSH 分组段头,会话行直接在相关工作区下平铺;行首供应商 icon;行形统一 0.875rem;选中 = accent-soft 底 + 2px 左竖条 | 用户选定。最贴近其引用的 AIchat 截图;实现面 = 删段头渲染 + 行形 CSS,分组数据装配(useCliSessionGroup/分页/置顶投影)零改动 |
| B · 时间分桶(GPT 式) | 同 A,另加 今天/昨天/7天内 段头 | 否决:多一层视觉分段,用户明确「大道至简」 |
| 保留分组仅美化段头 | 段头加大加亮,行不动 | 否决:不解决「多一层级」的核心诉求 |

实施形态定调:「cli 分组进行前端隐藏」—— 分组容器与数据管线保留(归档过滤/分页/置顶投影继续按 profile 装配),仅段头 UI 与折叠交互退役;**不做跨供应商时间混排**(各 CLI 块内部仍按时间倒序,块顺序 = profiles 注册序)。这是用户明确的极简边界,后续若要全局时间混排再单独立项。

## 设计要点

1. **段头退役**:`GroupHeader` / `useGroupCollapsed` / `settings.workspaceGroupCollapsedMap` 全部拆除(CI/终端/SSH 三组);分组恒展开。`revealSession` 不再补分组展开补丁。词典死键(展开分组/折叠分组)同步清理。
2. **行形统一**:所有会话行 0.875rem 同字重;`.thread-name.is-disk` 的等宽 0.75rem muted 降级规则删除;行首新增供应商图标槽(复用 `.thread-engine-badge`,CLI 行用 profile.renderIcon,终端/SSH 行用 TerminalWindow/HardDrive)。
3. **选中态**:`.thread-row.active` = `--tmd-accent-soft` 底 + `inset 2px 0 0` 左竖条,全列表唯一高亮行。
3b. **闲置灰点隐藏**(同日追加,用户目检反馈):`.tl-node.is-idle` display:none —— 灰静止点纯噪音;信号位只留 运行(绿呼吸)/未读(蓝呼吸)/查看中(Eye)/归档徽记;圆点绝对定位,隐藏无布局位移。
3c. **树形参考线回归**(同日追加,用户目检反馈 + Claude 侧栏参考图):`.workspace-children::before` 竖线(x=容器 16px,居文件夹图标中心,上探扎进文件夹行)+ 每行 `.thread-row::before` ╭ 形弯钩(border-left+bottom+6px 半径)拐向行首图标;状态圆点/查看眼/归档徽记骑线(作用域 `.workspace-children`,置顶区/运行区节点槽位不动);行缩进随之 8→16px(`--workspace-tree-indent`,更多…/wm-bar/wm-profile 同源)。末行收边靠 inner overflow 裁剪,不做 └ 收尾(ponytail:要曲尾需「最后行」判定,等用户提了再补)。
4. **时间轴轨道移除**:`.workspace-children::before` 贯穿竖线删除;`--workspace-tree-rail-x`(19.5px)更名 `--workspace-tree-indent`(8px),消费点 = thread-row / thread-more / wm-bar 三处;状态圆点/眼睛/「归」徽记的绝对定位在新缩进下不裁切(inner overflow:hidden,x≥1px)。
5. **会话管理入口上移**:WorkspaceCard 行动作组新增「会话管理」开关(hover 显形,激活常亮且锁定动作组展开):
   - ~~「归档」(Archive):切换 `settings.workspaceArchiveView`~~ —— **同日撤销(用户目检:与 caption「默认|归档」radio 冗余)**,归档视图唯一入口 = caption 分段开关。
   - 终端/SSH 组无管理概念,不接入。
6. **其他位置不动**:全局置顶区 / 运行区 / caption 动作区 / 分页「更多...」/ 右键菜单 / 归档视图行形(「归」徽记)全部保持现状。

## 验证

- `pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build` 全绿。
- 浏览器桩目检(浅色主题,1421 + Tauri 桩):① 工作区下无分组段头、行首供应商 icon、字号统一;② 选中行 accent-soft + 左竖条;③ 工作区行开关进管理态:复选行 + profile 识别行 + 拖选批量归档/删除;④ 归档开关切视图、「归」徽记行形不变;⑤ 终端/SSH 行平铺显示。
- 存量测试:settings.test.ts 去掉 workspaceGroupCollapsedMap 断言;selectRange 等管理态单测不动。
