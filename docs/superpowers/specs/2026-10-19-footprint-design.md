# 每日工作足迹(footprint)设计 spec

- 日期:2026-10-19
- 状态:定稿待实现(方向 = 交互原型 v2.1,大仙已拍板;本文定数据接口与时机)
- 前序:`docs/research/daily-work-footprint/`(总体调研 + 功能聚类闭环调研)、`docs/design/daily-work-footprint/`(v2.1 交互原型)

## 背景与目标

大仙每天用 AI 客户端干活,但「两个月前某天做了账号密码登录,涉及哪些工程文件/配置、改了多少」无法快速回答。现有工作日志(journal)是散文体日报,无文件维度、不可反查。

目标:独立 `src/plugins/footprint/` 插件,中央 tab,提供:

1. 月历热力定位到天(底色档 = 净增行分位,格内净增数字);
2. 当日功能卡流(标题 + 一句话 + 用户原话锚点 + 每卡会话/文件证据);
3. 证据抽屉(会话 resume / 文件清单 ± / diff 宽面板在主流展开);
4. ⌘K 关键词反查到天(功能卡/用户原话/日报/文件路径四来源);
5. 区间汇总(shift 拖选月历);
6. git 提交硬证据常驻(不受账本 30 天 TTL 影响)。

核心数据约束(调研实证):文件级 ± 的唯一来源是 checkpoints 账本,`CKPT_KEEP=100 / TTL=30 天` 且面板挂载即 prune——**必须新增按日 rollup 持久层**,否则「两个月前」无从谈起。

## 数据接口与进来方式

### 四条数据链总览

| 链 | 内容 | 写侧时机 | 存储 | 读侧消费 |
|---|---|---|---|---|
| L1 rollup | 文件级 ± + 会话 + batchId | 每轮封口后(事件驱动) | `~/.tmd-cli/footprint/YYYY-MM.json` | 月历热力/当日明细/区间汇总/文件清单 |
| L2 会话+日报 | 会话清单/日报文章/摘录 | journal 既有链(不改) | `~/.tmd-cli/workbench/journal/daily/*`(既有) | 当日时间线/搜索反查/功能卡兜底 |
| L3 功能卡 | AI 归纳的功能卡 JSON | 日报生成会话顺手直写(管线 A) | `~/.tmd-cli/footprint/features/YYYY-MM-DD.json` | 功能卡流/⌘K 反查 |
| L4 git 提交 | 仓 + hash + subject + 时刻 | git 本身(不写) | 各仓 .git | Git 硬证据区/老日子 ± 替代 |

### L1 rollup:量化层(核心新增)

**写侧挂点 = checkpoints 封口成功之后,经 kernel 事件解耦。**

- `src/kernel/events.ts` 新增 topic `ckptTurnSealed`,payload:

```ts
export interface CkptTurnSealedEvent {
  cwd: string;
  sessionId: string;      // CLI 会话 id
  tmdSessionId: string;
  turn: number;           // 账本轮次
  batchId: string;        // 封口批次 id(抽屉 diff 复用 checkpointBatchDiff 的钥匙)
  engine: string;         // 锚点 meta 快照
  attribution: "events" | "git";
  settledAt: number;      // 封口时刻(归日键)
  files: { path: string; add: number; del: number }[];
}
```

- emit 点:`checkpoints/index.tsx` 三条封口路径(`turnSettled→sealWith`、`sessionExited→兜底`、`sealDeadTurns→代封`)各自 seal IPC 成功返回后 emit。checkpoints 不懂 footprint,只广播「本轮封口了什么」——跨插件契约走 kernel events,与 `turnSettled`/`askDetected` 同模式,不违反「单插件语义不入 kernel」(topic + payload 类型是通用原语)。
- footprint 插件 `activate` 订阅 `ckptTurnSealed` → merge 进当月 rollup → `fsWriteFile` 原子覆写。

**归日规则:按封口时刻(settledAt)归日**,与账本 turn 时间一致;跨零点干到凌晨 1 点的改动归当天(事实时刻,不做业务日切)。

**存储:按月一文件**,`~/.tmd-cli/footprint/YYYY-MM.json`:

```ts
interface FootprintMonthFile {
  version: 1;
  days: Record<string, FootprintDay>;   // key = "14"(零填充由读写双方约定)
}
interface FootprintDay {
  sessions: Record<string, { engine: string; cwd: string; turns: number[]; first: string; last: string }>;
  files: Record<string, { add: number; del: number; cfg: boolean; refs: string[] }>;  // path → 聚合±;refs = 会话 id
  batches: Record<string, string>;      // sessionId → 最近 batchId(30 天内 diff 复用)
}
```

取舍(按月 vs 按日):
- **选定按月**:月历/区间/汇总全是月粒度读,一次 `fsReadFile` 完成;文件数不随历史增长;写入 = turn 封口(人节奏低频)。
- 被否:按日一文件——零写竞态但月历要 31 次读,还得加 Rust 聚合命令才不卡;收益撑不起新命令。
- 并发防护:footprint 模块级**单飞写队列**(promise 链串行,同进程无并发覆写);`writeJson` 走 `fsWriteFile`(Rust tmp+rename 原子替换,journal 先例);读侧 `readJson` 宽容(损坏 = 空月,不炸 UI)。
- cfg 标记:写侧按扩展名规则打标(`.yml/.yaml/.json/.toml/.ini/.conf/.env/.properties/.xml/.sql`),纯函数放 footprint 内。

### L2 会话 + 日报:复用,零改动

- 会话清单:走 `cli-shared` sessions 扫描(各 CLI 适配器),按会话开始日归日(与 journal 月历同源);footprint 只读。
- 日报:`daily/article/YYYY-MM-DD.md`(散文,搜索源 + 兜底聚类源)、`daily/digest/YYYY-MM-DD.md`(当日会话摘录,用户原话锚点来源)。

### L3 功能卡:管线 A,生成会话顺手直写

- **写者 = 日报生成会话**(真实 CLI agent,journal taskQueue 调度,与 article 直写同模式先例)。promptGen 的文章契约追加一段:写 `~/.tmd-cli/footprint/features/YYYY-MM-DD.json`:

```ts
interface FeatureCardFile {
  version: 1;
  cards: {
    title: string;          // 「账号密码登录」
    summary: string;        // 一句话
    sessions: string[];     // 引用的会话 id(必须来自当日 digest 枚举)
    quote?: { sid: string; text: string; time: string };  // 用户原话锚点
  }[];
}
```

- **时机**:与日报同任务、同会话、同一次生成——零新增调度与调用成本。
- **防编造**:tmd 读侧校验,`sessions[]` 逐个对照当日 digest 会话枚举,未命中 = 该卡降级「会话引用未验证」(sessionRef 枚举校验先例);文件缺失/损坏 = 该日无功能卡。
- **防漂移**(Chain-of-Key,调研结论):卡标题一经落盘即冻结;增量并入日,生成会话只「归卡/建卡」不重写旧卡措辞(prompt 明示);用户在 UI 点「修正」改的是 UI 覆盖层 `features/YYYY-MM-DD.user.json`(user 卡优先,原 AI 卡保留可回溯)。
- **升级闸**(管线 B 预留):连续两周采样,若格式校验通过率 < 80% 或卡粒度漂移明显(单日 > 12 卡或全部塞 1 卡),再把功能卡拆成独立轻量无头调用(单一目标,不受文章主目标敷衍)。
- **降级**(管线 C):无 features 的日子,功能卡区退化为「按项目分组的文件清单」(rollup files 按 cwd 顶层目录分组),诚实标注「未归纳」+「手动补归纳」入口。

### L4 git 提交:唯一新 Rust 命令

```ts
/** ipc 命名 git_repos_log_range;git 域通用原语,pluginPermissions 加映射 */
gitCommitsRange: (root: string, sinceIso: string, untilIso: string) =>
  invoke<{ repo: string; hash: string; subject: string; time: string }[]>(
    "git_repos_log_range", { root, since: sinceIso, until: untilIso }),
```

- Rust 侧:复用 git 插件的 repos 扫描先例(git2 thread::scope 并行),每仓 `revwalk` 按 committer 时间窗过滤。
- 点日/区间时 lazily 拉,模块级缓存 `(root, day)` 键。

### 复用清单(零新通道)

| 需求 | 通道 | 说明 |
|---|---|---|
| 抽屉 diff(30 天内) | `checkpointBatchDiff(cwd, batchId)` | rollup.batches 记了 batchId,直接复用 |
| 会话清单 | cli-shared sessions 适配器 | 与侧栏/工作日志同源 |
| 日报/摘录读取 | `fsReadFile` | journal 产物 |
| rollup/features 读写 | `fsReadFile`/`fsWriteFile` + readJson/writeJson 先例 | 无需新 Rust |
| 工作区根 | `ipc.configReadWorkspaces` | L4 的 root 来源 |

## 读侧时机(什么时机进来)

| 时机 | 动作 | 数据 |
|---|---|---|
| tab 首挂 / 切月 | 读当月 rollup(`fsReadFile`)+ cli-shared 按月扫会话 + 读当月 features | 月历热力、侧栏汇总、当月卡索引 |
| 点日 | rollup 当日节(内存已缓存)+ digest/article 两文件 + lazily gitCommitsRange | 当日三分区、Git 证据区 |
| 点卡「N 场会话」/ 文件行 | 开抽屉;点文件行 → `checkpointBatchDiff(cwd, batchId)` | 会话 resume 行、宽 diff 面板 |
| diff 超 30 天 | rollup 无 batchId 命中 → 降级态 | 「账本已清理」+ 数字保留 + git 跳转 |
| ⌘K 首开 | 现场读当月 ± 前后月 rollup/features/article/digest 建轻索引,结果缓存,turnSettled 失效 | 四来源命中卡 |
| shift 拖选区间 | 已缓存月 rollup 内存聚合(跨月补拉) | 区间汇总条 |
| turnSettled/ckptTurnSealed(今日视图打开时) | 内存 merge 当月缓存 + 当日细节刷新,不重读文件 | 月历今日格、当日视图 live 更新 |

缓存:模块级 `monthCache: Map<ym, FootprintMonthFile>`(LRU 3 个月),`ckptTurnSealed` 命中当月即内存更新并标脏;切月不重复落盘读。

## 插件骨架与边界

- `src/plugins/footprint/index.tsx` 实现 `Plugin`,中央 tab 挂点;`allPlugins` 注册一行。
- 内部三件:`rollup.ts`(写侧订阅 + 单飞队列 + 月缓存)、`query.ts`(读侧聚合:日明细/区间/搜索)、`view/`(月历 + 卡流 + 抽屉 + diff 面板,原型 v2.1 结构)。
- CLI 会话格式知识全走 cli-shared;不碰 PTY;不反向 import `@shell/*`;R4/R1/R3 零违反。
- i18n:全部用户可见文案走 `t()`,词典 en/ja 同步。

## 验证

1. 单测:rollup 归日(settledAt 跨零点)、单飞串行(并发封口不丢更新)、cfg 扩展名规则、features 枚举校验(未命中降级)、月缓存失效。
2. 集成(临时脚本):桩 `ckptTurnSealed` → 断言 rollup 文件按 schema 落盘、月历热力格数字正确;改系统时间不可行,归日用注入 settledAt。
3. `pnpm check:gate` 全链;`pnpm tauri:dev` 真窗口目检:挂载/切月/点日/抽屉 diff/降级态/⌘K/区间,对照原型 v2.1。
4. 回归:checkpoints 三条封口路径 emit 后,原有面板行为不变(TimelinePanel/store 测试全绿)。
