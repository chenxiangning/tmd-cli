# d 路修订评审:subagent 入口传 flag 才能让 ctx_memory 工具注册

日期:2026-09-06
状态:**通过**(实证闭环;实现定稿为「各引擎各自插件、按候选探测、不写死单一安装根」)
关联:PoC 报告 `docs/research/magic-context-poc-report.md` PoC-7 · spec `docs/superpowers/specs/2026-09-05-memory-coordinator-design.md` §2.2(v2 措辞已并入)

---

## 1. 背景与问题

PoC-2 当时(2026-09-05 22:54)实证:omp `-p` 跑 `proc_communicate` + "调用 ctx_memory 写入" 指令 → 模型成功调工具 → `memories` 表落行(`source_type='agent'`)。spec §2.2 据此选定 d 路。

PoC-7(2026-09-06 07:25 ~ 07:45)二次实证:**9/6 01:38 之后 0 落行**。排查后定位:

`@cortexkit/pi-magic-context/dist/subagent-entry.js` 的 `magicContextSubagentExtension(pi)` 是 `ctx_memory` 工具**唯一注册路径**,且仅在 `pi.getFlag("magic-context-dreamer-actions") === true` 时注册。dist 主入口(`dist/index.js:3336`)仅在 **main agent 启动 subagent 流程**(DREAMER_ACTION_AGENTS = `{dreamer, magic-context-dreamer}`)时,自动给 omp 子进程 push `--extension <subagent-entry.js>` + `--magic-context-dreamer-actions` + `--tools <hosttools>`。tmd-cli 的 d 路直接跑 `omp -p <指令>` **不会**经过 main agent 的 subagent 编排,因此 spawn 出的 omp 进程**无 ctx_memory 工具**,模型无可写入口,写入永远是 0。

补充:`historian_runs` 也为 0(`magic-context` 自带 historian 同样未跑),不在 d 路修复范围,需另行调研。

## 2. 真因(源码实证)

dist 关键代码片段(`@cortexkit/pi-magic-context/dist/index.js:3320-3360`):

```js
const shouldLoadSubagentExtension = subagentEntryPath && (
  SEARCH_ONLY_SUBAGENT_TOOL_AGENTS.has(options.agent) ||
  DREAMER_ACTION_AGENTS.has(options.agent)
);
if (shouldLoadSubagentExtension) {
  args.push("--extension", subagentEntryPath);
  if (DREAMER_ACTION_AGENTS.has(options.agent)) {
    args.push("--magic-context-dreamer-actions");
  }
}
```

即:`--magic-context-dreamer-actions` 是 main agent 给 **subagent omp** 注入的,**不是 omp 主进程自己识别的 flag**。手工 `omp --magic-context-dreamer-actions -p ...` 是**错误用法**——该 flag 只在 main agent 编排 subagent 时被识别并透传。

正确的"等价 d 路"形态:**手工模拟 main agent 启动 subagent 的参数组合**:

```bash
omp \
  --extension /Users/chenxiangning/.omp/plugins/node_modules/@cortexkit/pi-magic-context/dist/subagent-entry.js \
  --magic-context-dreamer-actions \
  --tools ctx_memory \
  --no-session \
  -p "<指令>"
```

`--no-session` 由我们自加(对应 dist 的 `sessionScopedToolsDisabled: true`,避免 subagent 落 omp 会话)。`--tools ctx_memory` 把工具列表收敛到 ctx_memory 一个,避免主进程默认工具(read/write/bash/...)被带进一次性 subprocess 引入治理面泄露。

## 3. 实证闭环(2026-09-06 07:45)

```bash
$ TS=$(date +%s); INSTR="调用 ctx_memory 工具,action=write,category=PROJECT_RULES,
content=flag-test-${TS}-proj-mc-flag-injection-probe,写完只回复\"已写入 1 条\"。"

$ omp --extension ~/.omp/plugins/node_modules/@cortexkit/pi-magic-context/dist/subagent-entry.js \
     --magic-context-dreamer-actions \
     --tools ctx_memory \
     --no-session \
     -p "$INSTR"
Working...
已写入 1 条。

$ sqlite3 ~/.local/share/cortexkit/magic-context/context.db \
   "SELECT id, category, content, source_type, datetime(created_at/1000,'unixepoch','localtime') \
    FROM memories WHERE content LIKE 'flag-test-${TS}%';"
5|PROJECT_RULES|flag-test-1788651927-proj-mc-flag-injection-probe|dreamer|2026-09-06 07:45:37
```

端到端闭环:`source_type='dreamer'`(flag 开启时走 dreamer 通道,与 agent 通道不同,但同写 `memories` 表)。

## 4. 修订方案

| 项 | 修订 |
| --- | --- |
| `src/plugins/memory-coordinator/paths.ts`(扩展,唯一路径来源) | 新增 `resolveSubagentEntry()`:渲染层零 node 内建,node 子进程探测候选(`~/.omp/plugins/...` 与 `~/.pi/agent/npm/...` 两根,subagent-entry 运行时自适应宿主,命中即用);env `TMD_MAGIC_CONTEXT_SUBAGENT_ENTRY` 最高优先(渲染层 `typeof process` 守卫)。新增 `isOpencodeMagicContextInstalled()`:opencode 配置文本含插件名判定(同 detect.ts 先例)。 |
| `src/plugins/memory-coordinator/phase2/write.ts` `viaOmp()` | omp/pi 分支:`await resolveSubagentEntry()` 缺失返 `missing-subagent-entry`;args = `--extension <hit> --magic-context-dreamer-actions --tools ctx_memory --no-session [--model m] -p <指令>`。opencode 分支:预检插件,未装返 `missing-plugin`;已装走 `opencode run`(PoC-8 探明其插件为自动注册,无需 flag)。 |
| `src/plugins/memory-coordinator/phase2/autoDistill.ts` | v2 注释更新;缺失早退收敛到 viaOmp(detail 携带),不重复探测。 |
| `src/plugins/memory-coordinator/phase2/write.test.ts`(新建) | 9 用例:args 形态 / model 插位 / pi / opencode 已装与未装 / archive·merge·distill 一致 / missing-subagent-entry / 非 0 退出。 |
| spec §2.2 / §3.3 | 修订决策描述:从"借道 omp -p"改为"借道 omp 子代理(subagent-entry.js + dreamer-actions flag)";新增 §X 路径不变性说明(`--tools ctx_memory` 收敛)。 |
| `openspec/changes/memory-coordinator/tasks.md` §8 | 追加"修订 d 路 v2"任务块。 |

## 5. 不在修订范围

- **opencode d 路**:本次未做 opencode 的 subagent 形态实证(`opencode run` 是否需要类似 --extension/flag 未测)。保留现状,另开 PoC-8。
- **上游侧不动**:不读 / 不改 magic-context dist。
- **Phase 1 不动**:只读消费面(胶囊检索、右栏面板)不受影响。
- **自动沉淀 UI**:本期不在 scope,等 d 路 v2 实证稳定后再补开关 / 状态卡(参 PoC-7 §"不在 d 路修复范围内的副作用")。

## 6. 风险

| 风险 | 缓解 |
| --- | --- |
| subagent-entry.js 路径在 win / Linux snap / Flatpak 等非 ~/.omp 部署下不存在 | env override `TMD_MAGIC_CONTEXT_SUBAGENT_ENTRY` + 安装编排 `detect.ts` 落盘预期路径 |
| subagent-entry.js 在上游升级中改路径或改名 | 安装编排 `setup.ts` 阶段解析并写 settings(`memoryDbPath` 同源策略);失败早退 |
| `--magic-context-dreamer-actions` 在上游更高版本移除 | 路径为评测探针(实测 0.41.3);升级时同步探测,`detect.ts` 跑 doctor 时附带 flag 存在性 |
| omp 子进程每次启动 5~15s(实测 ~14s) | d 路是用户主动 / 周期任务调用,非热路径;`OMP_TIMEOUT_MS=120s` 兜底 |
| 模型偶发"解释而不调工具"(同 PoC-2 提示词 bug) | `distillSessionTail` / `rememberFacts` 提示词已带"立即调用工具"强约束,本次不重写 |
| 同 workspace 并发退出多 omp 会话 | `distilled` Set 已做幂等;subagent 串行调用,SQLite 同库并发由 magic-context 自身负责 |

## 7. 验证

```bash
# 自动
pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size
# 手动 PoC 段(同 §3 实测脚本):
mkdir -p /tmp/mc-flag-test && cd /tmp/mc-flag-test
SUBAGENT=$HOME/.omp/plugins/node_modules/@cortexkit/pi-magic-context/dist/subagent-entry.js
TS=$(date +%s)
omp --extension "$SUBAGENT" --magic-context-dreamer-actions --tools ctx_memory --no-session -p \
  "调用 ctx_memory 工具,action=write,category=PROJECT_RULES,content=spec-verify-${TS},写完只回复\"已写入 1 条\"。"
sqlite3 ~/.local/share/cortexkit/magic-context/context.db \
  "SELECT id, category, content, source_type FROM memories WHERE content LIKE 'spec-verify-${TS}%';"
# 预期:1 行
```

## 8. 决议

| 决议 | 状态 |
| --- | --- |
| d 路 v2 修订方案 | **通过** |
| 实施范围 | 限 omp / pi;opencode 待 PoC-8 |
| 评审 | 单审通过,落 `openspec/changes/memory-coordinator/tasks.md` §8 续项 |
| 落地 | 本次不 commit,代码已落仓库待用户复核提交 |