## Context

预算弹窗(6a4e987)只落了设置写入与弹窗自身文案:`resolveCliSessionQuota` 唯一的消费点是弹窗 placeholder,真正的列表分页(`CliSessionGroup`)是模块常量 `PAGE_INITIAL = 10`,两者从未接线 —— 这是「设置不起作用」的根因。UI 侧,弹窗虽按 `host.getCliProfiles()` 动态枚举 CLI,但作为 workspace caption 的自制 portal 悬浮层,高度被 `clampBudgetPosition` 按视口裁到 ~480px,8 个注册 CLI 只显示前 4 个。项目已有设置域插件化的标准路径:`kernel/settingsRegistry` 注册表 + settings 插件头注释明示「其它设置域由各自插件注册新 section,本文件不需要改动」,目前仅「基础设置」在用。项目无组件测试设施(vitest 纯函数测试),UI 校验逻辑需抽纯函数才可测。

## Goals / Non-Goals

**Goals**
- 预算设置真实生效:各 CLI 分组初始露出条数 = 解析配额,预算修改响应式反映到列表
- 设置 UI 走注册表标准路径:workspace 插件注册 section,全量注册 CLI 自适应(行动态生成)
- 删除自制弹窗全套(portal/定位/专用 CSS),净删代码
- 工作区 caption 入口保留,深链直达该 section

**Non-Goals**
- 不改预算语义:共享总数 + 按 CLI 配额 + 未配置均分剩余、1–100/默认 20、sum(perCli) ≤ total、全局作用域(跨工作区),全部保持
- 不做每 CLI 插件自贡献配额行的扩展点 —— 为一个数字输入新增扩展点过重,注册表动态枚举已覆盖诉求(YAGNI)
- 不做 per-workspace 差异化预算
- 不引入组件测试设施

## Decisions

1. **UI 归属:workspace 插件注册设置 section(而非独立插件或保留弹窗)。** 备选:独立 `session-budget` 插件(为一个设置项单开插件,割裂域归属)、弹窗仅接线(不满足插件化诉求)。预算是会话列表的域,workspace 是唯一贡献者;settings 插件头注释预留的正是这条路。

2. **断裂接线:quota 即初始 limit,`useEffect([quota])` 同步。** `limit` 初值从 `PAGE_INITIAL` 改为解析配额;预算修改时重置各组分页(含已点开「更多」的组)。语义:改预算 = 按新预算重新露出,直觉且无叠加歧义。「更多」翻倍保留:`l > 0 ? l * 2 : PAGE_INITIAL` —— 显式 0 配额组首击加载 10 条,否则 0 翻倍恒 0 死锁。

3. **深链:`openSettingsPanel(target?: { sectionId; tabId? })`,settings store 存 `panelTarget`,SettingsPanel 以 effect 消费。** 不用 `useState` 初值(面板常挂载仅 `return null`,初值只在首挂载求值,二次打开不生效);不用全局事件(store 态可测试、与现有 `panelOpen` 同域)。target 指向的 section 缺席(插件被禁用)由现有 `find ?? sections[0]` 回落兜住。**每次调用都写 `panelTarget`(有参 = 定位目标,无参 = null)**:effect 依赖 `[panelOpen, panelTarget]`,若无参打开不覆盖 target,「深链打开 → 关闭 → 无参再打开」会因 panelOpen 翻真重新消费旧 target 残留定位;覆盖为 null 后无参打开保持「记住上次选中」的现状。

4. **校验抽纯函数 `budgetCommit.ts`。** 弹窗的提交校验(total 越界/小于已分配拒绝、quota 非整数或超 sum 拒绝、空串删 key、写入前剪已卸载 CLI 残留)原样平移为纯函数,返回 `{ ok, value | hint }`;BudgetTab 只做渲染与调用。项目无组件测试设施,纯函数进 vitest。

5. **样式零新增。** BudgetTab 复用 `pref-card/pref-row/pref-title/pref-desc` 与行为页同款输入框类;删 `workspace-menu.css` 的 `.wsbudget*` 块(~80 行)。

## Risks / Trade-offs

- **预算修改重置「更多」展开状态**:用户点到 40 条后改预算,组回到新配额重新起步。接受 —— 重置语义直观,且保留展开反而令「总数」失去意义。
- **0 配额组以「更多...(还有 N 条)」呈现**:初始磁盘历史一条不露,仅活会话可见。接受 —— 显式配 0 即该语义(弹窗文案已声明),「更多」仍可达全部历史。
- **配额均分随注册数变化**:禁用/启用 CLI 插件会改变「未配置」集合,均分结果随之浮动。接受 —— 与现语义一致,弹窗文案已声明。
- **深链 target 残留**:见决策 3 —— 每次调用都写 `panelTarget`(无参 = null),effect 仅在 target 非空时定位,无残留路径。
