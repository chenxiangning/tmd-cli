## Context

预算弹窗(6a4e987)只落了设置写入与弹窗自身文案:`resolveCliSessionQuota` 唯一的消费点是弹窗 placeholder,真正的列表分页(`CliSessionGroup`)是模块常量 `PAGE_INITIAL = 10`,两者从未接线 —— 这是「设置不起作用」的根因。项目无组件测试设施(vitest 纯函数测试),UI 校验逻辑需抽纯函数才可测。

首版实施曾按「设置域插件化」把编辑 UI 迁入设置面板(registerSettingsSection 注册「会话列表」section + openSettingsPanel 深链),**用户裁决否决:caption 悬浮弹窗是需要的形态**,该部分整体回退(kernel 深链 API、BudgetTab、section 注册全部移除),弹窗恢复原样。

## Goals / Non-Goals

**Goals**
- 预算设置真实生效:各 CLI 分组初始露出条数 = 解析配额,预算修改响应式反映到列表
- caption 弹窗保留为唯一编辑入口,UI 与交互原样;配额行动态枚举注册 CLI(全量自适应)
- 校验逻辑纯函数化,进 vitest;写入基底剪除已卸载 CLI 残留 key

**Non-Goals**
- 不迁设置面板、不加深链(已实施并被否决,回退)
- 不做每 CLI 插件自贡献配额行的扩展点(YAGNI,弹窗动态枚举已覆盖)
- 不改预算语义:共享总数 + 按 CLI 配额 + 未配置均分剩余、1–100/默认 20、sum(perCli) ≤ total、全局作用域,全部保持
- 不做 per-workspace 差异化预算

## Decisions

1. **UI 归属:保留 caption 弹窗(用户裁决)。** 曾实施「设置面板 section + 深链」方案,用户明确要求恢复弹窗、删除设置面板入口。弹窗本就动态枚举 `host.getCliProfiles()`,全量 CLI 适配不依赖迁面板。

2. **断裂接线:quota 即初始 limit,`useEffect([quota])` 同步。** `limit` 初值从 `PAGE_INITIAL` 改为解析配额;预算修改时重置各组分页(含已点开「更多」的组)。语义:改预算 = 按新预算重新露出,直觉且无叠加歧义。「更多」翻倍保留:`l > 0 ? l * 2 : PAGE_INITIAL` —— 显式 0 配额组首击加载 10 条,否则 0 翻倍恒 0 死锁。

3. **校验抽纯函数 `budgetCommit.ts`,弹窗只做渲染与调用。** 提交校验(total 越界/小于已分配拒绝、quota 非整数或超 sum 拒绝、空串删 key、写入前剪已卸载 CLI 残留)返回 `{ ok, value | hint }`。**顺带修正**:已分配之和按剪除残留后的基底计算 —— 原实现残留 key 会虚增「已分配」,导致总数被误拒。

4. **kernel 零改动。** `SessionListBudget` 语义、`resolveCliSessionQuota`、sanitize、`openSettingsPanel` 原签名全部保持;回退后不留深链等一次性 API。

## Risks / Trade-offs

- **预算修改重置「更多」展开状态**:用户点到 40 条后改预算,组回到新配额重新起步。接受 —— 重置语义直观,且保留展开反而令「总数」失去意义。
- **0 配额组以「更多...(还有 N 条)」呈现**:初始磁盘历史一条不露,仅活会话可见。接受 —— 显式配 0 即该语义(弹窗文案已声明),「更多」仍可达全部历史。
- **配额均分随注册数变化**:禁用/启用 CLI 插件会改变「未配置」集合,均分结果随之浮动。接受 —— 与现语义一致,弹窗文案已声明。
