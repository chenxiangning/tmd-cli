# 工作台(workbench)设计 spec

- 日期:2026-10-10
- 状态:已实施(含三轮打磨;全门禁绿 + 1421 桩目检通过;未提交,待大仙 review)
- 目标版本:0.3.5
- 需求来源:多项目管理痛点(项目多易漏细节、重点开发/切换调研频繁、进度无法全记);UI 参考 OliverLiy/projectHub(dsh 工作台「项目总控台」,本地仓库 /Users/chenxiangning/code/AI/github/projectHub)

## 背景与目标

把散在脑子里和表格里的多项目状态收进 tmd-cli:一屏看完「谁在跑、谁要炸、谁快到期」,项目下有任务、PRD、进展记录,处理项目的 CLI 会话一键可达。

目标形态:

- 新插件 `src/plugins/workbench/`(id `workbench`,feature 类),全屏覆盖层(与插件市场/会话看板同款「不透明盖住三栏、下层零回放」)。
- 左缘 LeftRail 入口**第一位**;rail 重排为:工作台 → 回到首页 → 插件市场 → 会话看板 → 切换工作区。
- 七个视图页签(2026-10-10 二轮迭代:状态看板与任务板合并为「看板」,上项目状态列、下任务三列一屏汇总):概览(KPI + 风险分布环形图/模块负载堆叠条/进度分布直方图/负责人负载)、模块看板、**看板**(合并)、列表、日历、时间线、待跟进(到期分桶);左侧模块导航 + 智能视图筛选 + 关键字搜索全页签联动。
- 项目详情弹层(DialogShell):宽 860 自适应夹取,内容高度自适应(至视口余量后内部滚动);关键信息网格、时间风险条、说明与标签、**PRD(内嵌 markdown 与文件路径双兼容)**、**任务管理**、进展记录时间线、**绑定 cwd 后的最近 CLI 会话(点击回侧栏会话)+ 一键开新会话**。
- 「问一句」本地问答(纯函数查数据,零 LLM 依赖);「周报/状态汇报/风险清单/会议纪要」提示词生成,一键复制到会话。
- 示例数据(12 项目,相对今天生成,带「示例」标签,可清空)。

数据模型(核心实体):

```
Project { id, name, module, status: 进行中|待启动|阻塞|暂停|已完成, owner,
          startedOn?, dueDate?, progress, link?, summary?, tags[],
          prd?: { markdown?, path? },          // 双兼容
          cwd?: string,                        // 可选绑定工作区根
          createdAt, updatedAt,
          updates[] { id, at, kind, text },    // 进展记录
          tasks[]  { id, title, status: todo|doing|done, owner?, dueDate?,
                     order, createdAt, updatedAt, doneAt? } }
```

projectHub 的「待跟进 todos」与任务合并为一个 task 实体:待跟进视图 = 未完成任务按到期日分桶(已逾期/今天/本周内/更晚/未排期)。

## 方案取舍

| 决策点 | 选定 | 被否决 | 理由 |
|---|---|---|---|
| 任务模型 | 项目级 + 项目内任务实体(大仙选) | 照搬 projectHub 仅项目级;任务再关联 sessionRef | jira 式任务板是明确诉求;sessionRef 回跳超出 0.3.5,绑定 cwd 后详情页本就能看到项目会话,收益重叠 |
| PRD 存储 | 内嵌 markdown + 文件路径双兼容(大仙选) | 仅内嵌;仅路径 | 内嵌保编辑体验,路径保长文/外部维护;项目分文件存储让内嵌长文不拖累索引 |
| AI 填充 | 不做 NL 增删改(大仙选) | 本地规则解析;经 CLI 会话异步解析 | 插件层无宿主 LLM API;规则解析能力弱是伪能力;会话异步慢且打断覆盖层交互。保留「问一句」本地问答与提示词复制,零 LLM 依赖 |
| 工作区关系 | 项目可选绑定 cwd(大仙选) | 完全独立;强制从工作区生成 | 绑定解锁会话联动;强制生成会让模块/状态等自由字段没处放 |
| 入口形态 | overlay 全屏覆盖层 | 中央 tab;右栏面板 | 七八个看板需要整幅宽度(projectHub 也是 68% 主区);session-board/市场先例同款,左 rail 动作 + active 点亮语义现成 |
| rail 排序实现 | 既有 order 地带调号(工作台 10/首页 20/市场 30/看板 40/工作区 50) | 新增排序配置面 | 一次性的用户口径排布,配置面是 YAGNI;壳仍零业务知识 |
| 存储 | `~/.tmd-cli/workbench/`:index.json(轻索引)+ `project-<id>.json`(全量分文件) | 单一 state.json;localStorage | intent-canvas 先例(索引+分文件);fs_read_file 有 512KB 读闸,分文件隔离长 PRD;localStorage 容量与持久性都不配「项目管理数据」 |
| 并发检测 | 不做 rev 冲突检测,内存单权威 + 写穿,写失败回滚内存态 | projectHub 的修订号检测 | tmd-cli 单主窗口,无双写方;写失败回滚保一致,修订号是给多窗口的(dsh 允许多窗,tmd 不允许) |
| 原子写 | ipc.fsWriteFile 直写(先 fsCreateDir 兜目录) | temp+rename | 与 intent-canvas/checkpoints 同一风险面;Rust 侧 fs_write_file 即现有先例,不新增原语 |

移植映射(projectHub → workbench,JS → TS,宿主 API → tmd 语义):

| projectHub | workbench | 变化 |
|---|---|---|
| shared/analysis.js | analysis.ts | 原样移植 + task 到期分桶 |
| shared/views.js | views.ts | 原样移植 |
| shared/insights.js | insights.ts | + 任务板列装配 |
| shared/query.js | query.ts | + 任务问答口径 |
| shared/prompt.js | prompt.ts | 原样移植 |
| shared/sample.js | sample.ts | + 每项目任务样本 |
| shared/aiplan.js | (不移植) | AI 填充否决,见上 |
| client/*(982 行 panel 等) | React 组件树按 300 行铁则拆分 | 样式走 --tmd-* 令牌,容器查询适配 |
| dsh/store.js 原子存储 | store.ts | 去 rev,写失败回滚,见上 |

## 二轮迭代(2026-10-10 大仙反馈,参考项目仅为 base)

1. **生成文档预览**:四种文档类型与进展分析提示词点击后进入 DocPreviewDialog 全文预览 + 复制全文(原文案直复制导致「点了都一样」的感知)。
2. **项目资料管理**:项目新增 `docs[]`(markdown/附件/图片),实体内容落 `docs/project-<id>/` 目录文件、index 只存轻元数据;详情弹层「文档」页签 = 新建(直接进编辑)/编辑/上传(24MB 闸)/图片点击预览/删除;旧 PRD 字段移除,加载时自动迁移为首篇「PRD」文档。
3. **任务本体与会话 link**:任务新增 `description`/`attachments[]`/`sessions[]`;任务详情弹层(禅道式:描述+附件+关联会话,侧栏基本信息+状态下拉);会话纯 link(host=活会话聚焦可兜底磁盘恢复 / disk=磁盘恢复),一个任务可关联多个会话,不侵入会话体系;发起会话自动复制「任务上下文 + 回写约定」到剪贴板。
4. **AI 回写规则**:`~/.tmd-cli/workbench/AI-TASKS.md` 声明可改字段(仅 status/doneAt/updatedAt)与整文件 JSON 重写方式;顶栏「从磁盘同步」= reloadWorkbench 强制重读。
5. **看板汇总**:任务段改禅道式表格(任务/项目/状态/负责人/截止/会话数/就地推进+详情);概览加任务统计(完成率环形+未完成/完成/逾期/本周到期)。
6. 冗余清理:PRD→docs 合并、KIND_LABELS 收敛 kindLabels.ts、taskColumns 随表格化删除(taskBoard.ts 更名 followUpBuckets.ts)、store 三分(storeCore/store/storeDocs)。

## 验证(二轮)

- 全门禁:typecheck 0 错、全量 3833 测试、arch/file-size 过、react-doctor 100、build 过。
- 桩目检:文档新建即编辑→保存→列表;概要统计条计数与跳页签;周报预览全文+复制;看板任务表格列/行/建任务;任务详情(描述回显/上传钮/开新会话并关联/侧栏字段)。

## 三轮迭代(2026-10-10 大仙五点反馈)

1. **弹层「点两下关不掉」**:kernel/DialogShell 层修 —— 连点关闭时第二击落在下层同位可点元素(卡片/表格行)把刚关的弹层重开;最后一个弹层卸载时铺 400ms 透明全屏罩吃掉残余指针事件,落罩走 0ms 延时 + 存活计数复核(StrictMode 挂载期假 cleanup 与「上层关下层仍开」都不落罩)。全部 DialogShell 消费方一次治愈。
2. **任务↔会话闭环**:点关联会话/开新会话成功即 `closeWorkbenchOverlay()` 落回侧栏会话(盖着看不到等于没打开);任务看板接真 toast(此前静默吞失败)。
3. **建任务表单打磨**:负责人缺省随项目、开始日缺省今天(编辑保持原值)、标题自动聚焦、Enter 提交。
4. **文档存储修复**:docs 目录 `~/.tmd-cli/workbench/docs/project-<id>` 两级,原单发 fsCreateDir 非递归必 ENOENT —— 改用 kernel/fsDirs 逐级建目录。**上传附件/图片改绑到文档**:markdown 文档新增 `attachments[]`(编辑器内上传/预览/删除),项目级上传入口撤除;旧 file/image 文档兼容保留;附件类型 TaskAttachment 更名 Attachment 任务/文档共用。
5. **看板改任务看板**:「看板」页签更名「任务看板」,改为 待办/进行中/已完成 三列任务卡(就地推进/点卡开详情);项目状态列并入「模块看板」顶部,消两看板冗余。

### 三轮自查补修(同日)

1. **host link 指向已关会话静默无效**:`setActiveSession` 对已移除会话不抛错,原 catch 兜底永不触发,用户视角即「link 不过去」;改为先查 `host.getSessions()` 存活,死链走磁盘身份兜底恢复,再不行明示「会话已结束」。
2. **Esc 叠层齐关**:kernel useEscClose 加注册顺序栈,只有栈顶响应 Esc(locked 顶层占位不让下层漏接),修「弹层摞弹层一次 Esc 全关」;桩检 抽屉+任务详情 两层逐层关闭,覆盖层本层 Esc 收口正常。
3. **建任务 Enter 连击双建**:submit 加 busy 守卫(DialogShell locked 只挡 Esc/背板,不挡键盘)。
4. **工作台发起的会话是孤儿**(大仙实证):createSession/openDiskSession 第三参 workspaceId 恒 undefined → 侧栏工作区树不收、运行时不关联,与工作区发起的会话两样;新增 `views.resolveWorkspaceId`(root 精确命中优先,子目录取最深路径前缀),任务详情「开新会话并关联」/打开链接/项目抽屉会话页签四处全部携带(同 daily-journal 口径)。

## 验证(三轮)

- 全门禁:typecheck 0 错、全量测试、arch/file-size 过、react-doctor 100、build 过。
- 1421 桩目检:真实双击关闭 4/4 轮弹层保持关闭(修复前可复现重开);新建文档落盘路径含逐级 creates 链 + 实体写入;文档内附件上传(DataTransfer File)挂载/删除;任务看板三列/表单默认值(owner=项目、开始=今天、自动聚焦、Enter)/就地推进;模块看板项目状态列在顶;任务详情三段与「开新会话并关联」无会话守卫 toast。
- 未目检:会话 link 打开成功路径(需真 CLI 会话)——代码路径 typecheck 过,真机验证。

## 四轮迭代(2026-10-10 大仙三点反馈)

1. **左侧导航栏删除**:OverlayNav(模块/智能视图/搜索)整列撤除,视图全宽;筛选链死代码一并清理(selectProjects/matchesSmartView/railViews/SMART_VIEWS/searchText/FilterState + 对应测试)。
2. **模块看板意图专一**:撤项目状态列,唯一分类轴 = 模块(段头统计 + 项目卡墙,状态收进卡片徽标);statusColumns/StatusColumn/statusTone 死代码清理。
3. **项目抽屉 90%**:DialogShell 加可选 cardClass,ProjectDrawer 传 `wb-drawer-shell`(90vw×90vh,`!important` 压卡片内联 width;内容纵向滚动、页脚常驻)。

## 验证(四轮)

- 全门禁:typecheck 0 错、全量 3833 测试、arch/file-size 过、react-doctor 100、build 过。
- 1421 桩目检:`.wb-nav` 无、页签直挂 wb-main;模块看板无状态列、纯模块分区;抽屉实测 90vw×90vh、正文滚动、页脚可视。

## 五轮迭代(2026-10-10 大仙三点反馈:中央 tab 化)

1. **项目详情弹层之死**:90% 弹窗(ProjectDrawer/DialogShell 壳)改为**中央 tab**——`wb.project` kind 经 `ctx.registerTabContent` 注册(插件 activate 期),卡片/答案 chip 一律 `openProjectTab`(wbTabs,开 tab 同时收覆盖层);`ProjectDetail.tsx`(原 ProjectDrawer 去壳)为内容体,编辑/建任务/文档预览弹层内聚组件自理;ProjectTab 按 payload.projectId 从 live 快照解析,项目已删渲染空态。tabContent.contract.test 双向表补 `wb.project`。
2. **附件直开文件 tab**:`kernel/fileTabs.openFileInTab` 加可选 title(内部存储名不可读,工作台附件传原名);文档附件与任务附件点按 —— 图片仍预览,其余一律开文件 tab(数据盘真文件,真机直接可编辑)。
3. **DialogShell cardClass 撤除**(四轮为 90% 弹窗所加,随弹窗之死清理);`wb-drawer-shell` CSS 删除。

## 六轮迭代(2026-10-10 大仙三点反馈:tab 化收口 + 任务包预填)

1. **任务会话预填**:`kernel/composerExt` 新增待注入槽(`queueComposerText`/`takeQueuedComposerText`,10s TTL)——写入方创建会话前排队,Composer **挂载期一次性消费**,规避 ref 桥把文本注进切换前旧会话的竞态;`taskPrompt` 扩附件清单(逐条名称 + `.tmd-cli/workbench/docs` 磁盘路径 + 体积,AI 可直接按路径读文件);任务详情「开新会话并关联」改 queue + `setActiveSession`,剪贴板通道退役。
2. **工作台本页 tab 化**:`WorkbenchOverlay`(wb-overlay-page 全屏覆盖)退役,改 `WorkbenchTab`(kind `wb.console`,id `wb-console`)走中央 tab;overlayStore 整文件删除,侧栏入口 active = tab 在开(经新 `kernel/tabs.subscribeEditorTabs` 桥),点击 = `openWorkbenchTab` 激活;OverlayActions 撤关闭钮(tab 条自带 ×);Esc 不再关本页(DialogShell 族弹层自收不变)。
3. **模块看板退役**:与项目列表内容重复 —— ModuleBoard.tsx 删,`WbTab` 去 `modules`,页签「列表」更名「项目列表」,locales(en/ja)同步;项目卡片面收口到列表行(名称即 onOpen → openProjectTab)。

## 七轮修复(2026-10-10 真机双 bug)

1. **任务附件点不开**:任务详情附件行 onClick 仍挂旧内联正则分支(非图片弹「在工作台数据目录内」toast),未走升级后的 `previewAttachment` → 统一 `onClick={() => previewAttachment(att)}`(图片预览/其余开文件 tab);死 toast 文案与 en/ja 键删除。
2. **预填落空**:`host.createSession` 默认 `activate:true`,spawn 过程中就激活会话,Composer 在 `.then` 排队**之前**已 mount 消费空槽 → 排队提前到 spawn 之前;失败路径 `clearQueuedComposerText` 清槽(TTL 10s 兜底慢 spawn),composerExt 加 clear API + 用例。

## 八轮(2026-10-10 任务详情弹层三点)

1. 关联会话行实时化:`useHost()` 订阅活会话表,行名取 `host.getSessions()` 命中(id 或 cliSessionId 磁盘身份)的**实时标题**(CLI 自动改名跟随),无命中回落 link 快照;状态徽「运行中」(accent 点亮)/「已完成」(静默)替代原「活会话/磁盘会话」文案(en/ja 同步,死键清理)。
2. 弹窗 90%:DialogShell 复活 `cardClass`(round-4 清除后按需回归),任务详情挂 `wb-task-shell` = 90vw×90vh + flex 子项 `margin-block:auto` 垂直居中(超高回落顶部滚动不裁切),正文 `.wb-taskdetail` 纵向滚动、页脚常驻。
3. 桩实测:1229/1365=90vw、691/768=90vh、top=38 居中;死链徽「已完成」+ 快照名回落正确。

## 任务生命周期定稿(2026-10-11)

状态机:`todo 待办 → doing 进行中 → done 已完成`,无不可逆终态——done 可经详情下拉回到 todo/doing(重开)。

| 转换 | 触发点(交互面) | 时间戳副作用(唯一收口 `store.updateTask`) |
|---|---|---|
| todo→doing | 任务看板卡「进行」钮;任务详情状态下拉 | `startedOn ??= 当日`(重开再入 doing 不覆盖首值) |
| doing→done | 任务看板卡「完成」钮;任务详情下拉 | `doneAt = now` |
| done→todo/doing | 任务详情状态下拉(重开) | `doneAt` 清空;`startedOn` 保留 |
| todo→done | 任务详情下拉(跳过进行,允许) | `doneAt = now`;`startedOn` 不补 |

外部触发:关联会话按 AI-TASKS.md 约定回写后,经顶栏「从磁盘同步」重读 index 走同一 `updateTask` 收口,副作用一致。禁止新增第四态;状态间不做门禁(允许跳转),时间戳由收口保证单调可信。

## 验证(八轮)

- typecheck 0 错、全量 3839 测试、react-doctor 100、build 过。
- 待真机:运行中会话的实时名跟随与「运行中」徽(host 活会话表桩里造不出,逻辑为 3 行 find,真机开一次活会话即可确认)。


- typecheck 0 错、全量 3839 测试、react-doctor 100。
- 预填时序(排队早于 spawn 激活)真机复验:点「开新会话并关联」→ 新会话输入框应已含任务包全文(含附件清单)。


- 全门禁:typecheck 0 错、全量 3838 测试(composerQueue 槽契约 + taskPrompt 附件内容新用例;tab 契约表补 `wb.console`)、arch/file-size 过、react-doctor 100、build 过。
- 1421 桩目检:侧栏/深链开工作台 → 中央「工作台」tab(页签 概览/任务看板/项目列表/日历/时间线/待跟进,模块看板消失);项目列表行 → 项目详情 tab;顶栏窄容器按钮整钮换行不折字。
- 待真机:任务「开新会话并关联」后新会话输入框应已含任务包(桩无 profile/PTY listen 通道,无法造真会话;槽契约与 taskPrompt 内容已测试钉死,Composer 经 useState 初始化器消费)。

## 验证(五轮)

- 全门禁:typecheck 0 错、全量 3833 测试(含 tab 契约双向锁定)、arch/file-size 过、react-doctor 100、build 过。
- 1421 桩目检:卡片点击 → 覆盖层收起 + 中央区出现「springboot-demo」tab(概要/文档/任务/进展/会话页签全渲染);附件点按 → 中央出现文件 tab,标题=「产品需求文档.md」(同 id 重开只激活不刷标题为 openTab 设计语义,改名前遗留 tab 需手关);文件内容加载需真盘文件,桩环境报 os error 2 属预期。




