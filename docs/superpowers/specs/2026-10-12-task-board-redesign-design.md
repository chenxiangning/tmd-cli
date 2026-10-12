# 工作台任务看板重构设计:五态状态机 + 泳道精修 + 拖拽改态

- 日期:2026-10-12
- 状态:已实施(门禁全绿;1421 桩目检拖拽与五态渲染通过;真机目检留大仙)

## 背景与目标

任务看板(`src/plugins/workbench/screens/TaskBoard.tsx`,2026-10-11 泳道化)现状三条痛点,均为大仙提出:

1. **状态粒度不足**:仅 `todo/doing/done` 三态,缺「待验收」与「已取消」终点,任务交付后到关闭前无缓冲态,放弃的任务只能混在待办或强行标完成。
2. **UI 粗糙、无拖拽**:状态推进只能靠卡片上的「进行/完成」按钮逐档点,无法像专业看板(Jira/Linear/Trello)一样拖拽卡片跨列改态;列头是裸文字 + 裸计数,卡片信息密度低。
3. **已完成列无限膨胀**:done 任务永久堆在列里,拖累扫读。

目标:状态机扩为五态、看板 UI 向专业看板对齐(泳道保留)、原生 HTML5 拖拽改态、已完成列默认收起历史。旧磁盘数据零迁移。

## 方案取舍

### 状态集合

**选定:五态** `todo 待办 → doing 进行中 → review 待验收 → done 已完成` + 终点 `cancelled 已取消`(不占列)。

- 看板列 = 前四态;cancelled 不进列(看板隐藏该任务),设置入口 = 任务详情状态下拉。
- 理由:黄金五态覆盖「交付待确认」与「主动放弃」两个真实场景;列数 4 在泳道网格下不挤。
- 否决 四态(无 cancelled):放弃型任务无处安放,只能污染待办。
- 否决 六态(含收件箱 backlog):6 列泳道行内过挤,且与现有「未排期」语义重叠。

### 终结态口径

`done` 与 `cancelled` 同为终结态。新增 `isTaskOpen` 谓词(status 非 done 且非 cancelled),统一替换各处 `status !== "done"` / `status === "done"` 判定:待跟进分桶(followUpBuckets)、KPI/逾期统计(insights)、openTasks、prompt/query 任务清单。已取消任务不再计逾期、不进待跟进、不进 AI prompt 未完成清单。

### 布局形态

**选定:泳道保留 + 精修**(行 = 项目可折叠,列 = 状态吸顶,现状骨架升级)。

- 理由:多项目对比是工作台核心视角;现状骨架用户已熟悉,改动聚焦。
- 否决 纯列式(Trello 式):列 = 状态横排、卡片带项目色条。经典但丢掉项目分组对比视角,与「工作台 = 多项目总览」定位冲突。
- 否决 双模式切换:两套布局双份维护成本,收益不明确。

### 拖拽实现

**选定:HTML5 原生 DnD,零新依赖**。

- 卡片整卡 draggable;拖拽中源卡半透明(`is-dragging`),目标列高亮(虚线边框 + 底色,`is-drop-target`)。
- 放置域 = 同泳道内其他列;跨泳道禁止(任务归属项目不可变,跨项目移动不是改态)。
- 键盘/按钮路径保留:推进钮标签随态变(开始/送验收/完成),详情页下拉任意跳态,可及性不丢。
- 否决 引入 dnd-kit 等库:技术栈铁律不引入新依赖;原生 DnD 对本场景(同列网格内搬家)足够。
- 否决 列内拖拽排序持久化:`order` 字段维持截止日排序语义,本次不做;要做需另开排序契约。

### 已完成列防膨胀

**选定:默认只显示近 7 天完成的任务**,更早的收进泳道内「+N 更早」展开按钮(会话内局部态,不持久)。列头计数仍是全量。否决全量显示(现状痛点本身)。

### UI 精修清单(对齐 Jira/Linear 语言)

- 列头:状态色圆点 + 名称 + 计数胶囊(pill 化,替裸数字);review 列用 warn 色系。
- 卡片:hover 浮起(阴影 + 边框提亮);负责人缩写圆标;截止日 pill(逾期红);会话计数带图标;拖拽光标 grab/grabbing。
- 空列:虚线占位「拖到此列」,既引导拖拽又填充视觉空洞。

## 数据与契约改动

- `types.ts`:`TaskStatus` 扩五态;`TASK_STATUSES` 全序 `[todo, doing, review, done, cancelled]`;新增 `BOARD_STATUSES`(前四,看板列用)与 `isTaskOpen`。
- `kindLabels.ts`:`TASK_STATUS_LABELS` 补 `review: 待验收`、`cancelled: 已取消`。
- `store.ts updateTask`:`startedOn` 进 doing/review 时补(原仅 doing);`doneAt` 仅 done 持有不变;cancelled 落 doneAt 清空。
- `workbenchFiles.ts` AI-TASKS.md 规则文:`status` 允许值更新为五态 + cancelled 语义说明。
- `taskPrompt.ts` 文案同步;`taskStatusTone`:done=ok、doing=info、review=warn、todo/cancelled=muted。
- 自动纳管(useTaskAutoStatus/pendingAutoDoing)不变:只 todo→doing。
- i18n:en/ja 补译 待验收/已取消/拖到此列/+N 更早 等。

## 文件落点(守 300 行铁则)

- 拆 `screens/boardDnd.ts`(DnD 纯逻辑:放置目标判定、状态映射,无组件,避 only-export-components)。
- 拆 `screens/TaskCard.tsx`(卡组件 + 拖拽源行为)。
- `TaskBoard.tsx` 只留屏装配 + 泳道行。
- CSS 全部走 `workbench.css` 既有 `--tmd-*` 令牌,不自造色板。

## 验证

- `pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`。
- 现有测试适配:workbenchPure/workbenchStore(doneAt 语义、五态归一化);新增 boardDnd 纯逻辑测试(同态放置忽略、cancelled 不可拖入等)。
- 1421 + Tauri 桩目检:五态列渲染、拖拽四向(相邻前进/跨档/回退/非法跨泳道)、done 历史收起展开、推进钮标签链。
- 提交前 `npx react-doctor@latest -y` 100 分。
