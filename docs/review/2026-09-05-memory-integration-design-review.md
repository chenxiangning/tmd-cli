# 8 引擎 Memory 集成设计(走法 B)评审记录

日期:2026-09-05
状态:**已完成 —— 不通过,退回修订**
对象:`docs/research/magic-context-8-engine-integration.md`(下称「设计稿」)
评审方式:代码事实核对(kernel/plugins/Rust 原语逐项验真)+ 上游文档对照

---

## 0. 结论

**不通过。** 走法 B 的骨架(3 家委托 Magic Context + 5 家自家 adapter + 插件化路由)成立,但存在 **3 个 P0 设计错误**:注入面、抽取模型、Rust 依赖各有一条不可行或不自洽的主张,必须重设计后才能转 spec。另有问题 4 项 P1、4 项 P2、5 项 P3。

判定依据:设计稿引用的三个关键落点(`src/kernel/prompt.ts`、「tiny role 模型」、「不改 Rust 直读 SQLite」)经代码核对全部不成立或不自洽,详见下。

---

## 1. P0:设计错误(必须重设计)

### F1 ·「经 kernel 注入 system prompt」不可行

- **位置**:设计稿 §5.2(「经 kernel 注入 system prompt」)、§5.3、§6.1(「prompt 拼装层 hook src/kernel/prompt.ts(待 PoC 定位)」)、§6.2。
- **问题**:tmd-cli 是 **PTY 宿主**,不是模型调用方。8 家 CLI 各自拼各自的 prompt、调各自的模型;tmd-cli 只透传 PTY bytes,**不存在任何「prompt 拼装层」**。代码实证:`src/kernel/` 目录无 `prompt.ts`(完整清单已核对,最近似的是 terminalReports / messageAnchors,均非 prompt 层)。
- **修订方向**:注入面改为两条真实通路——
  1. **各 CLI 的 context file 机制**:omp/pi 读 `.omp/AGENTS.md`、claude 读 `CLAUDE.md`、codex 读 `AGENTS.md`(omp 课 11 讲的规则继承体系);tmd-cli 把 memory 摘要落到这些文件即完成「注入」,由 CLI 自身在启动时读取。
  2. **Magic Context 自带注入**:pi/omp adapter 本身做 recall 注入,装好即得,无需 tmd-cli 参与。
  - tmd-cli 侧只剩「写 context file」这一动作,归 memory-coordinator 插件,kernel 零改动。
- **连带修订**:§6.1 改动清单中「prompt 拼装层 hook」一行删除;§5.3 的 KV cache 论述改写(注入点变了,terminalInputGate 那条论据也见 F17)。

### F2 · fact-extractor「调 tiny role 模型」概念错位且自相矛盾

- **位置**:设计稿 §4.1 第 3 条、§4.2 流程、§6.3 风险点 3。
- **问题**:`tiny` 是 **omp 的 modelRoles 配置项**(见 `docs/research/omp-cli-course/README.md` §「模型 role 表」),不是 tmd-cli 的能力。tmd-cli 自身无模型调用体系;且设计稿 §1.4 非目标明文「不实现 tauri 内任何 AI 调用」,§4.2 的 fact-extractor 恰是 tauri 内 AI 调用——**同文档自相矛盾**。
- **修订方向**(三选一,推荐 a):
  - a. **抽取复用 Magic Context historian**——setup 时已配 historian model,其「压缩时提取 durable knowledge」本来就是这条管线(上游 README 实证);5 家 adapter 只负责把 session JSONL 喂给它可消费的入口,不自己调模型。
  - b. 经 `proc_communicate`(Rust 原语已存在,`src-tauri/src/lib.rs:152`)跑外部抽取命令,tmd-cli 内仍无 AI 调用。
  - c. 明确推翻 §1.4,在 spec 的「方案取舍」里论证 tmd-cli 内置模型调用的必要性(不推荐,引入 provider/key 管理新面)。

### F3 ·「不修改 Rust 侧也能直读 SQLite」不成立

- **位置**:设计稿 §6.2 第 4 条(「不修改 Rust 侧…不新增 Tauri command 也行」)、§2.2 决策点 1。
- **问题**:webview 内 JS 无文件系统直读权限,「直接读 SQLite」在 Tauri 里必须经 Rust。代码实证:现有原语仅 `fs_walk_files` / `proc_communicate`(`src-tauri/src/lib.rs:146,152`)+ fs 读写族,**无 sqliteQuery**(memory 摘要提到的 sqliteQuery 是针对未来 CLI 私有库读取的约束条款,当前代码没有)。
- **修订方向**(二选一,需在 spec 定夺):
  - a. **新增只读 `sqliteQuery` Rust 原语**(一处,`src/kernel/ipc.ts` 唯一 import 点,符合 R3)——快、稳,但坐实「要改 Rust」。
  - b. **经 `proc_communicate` 跑 `sqlite3` CLI**——零 Rust 改动,但引入用户机器须装 sqlite3 的前置依赖,且引号转义面大。
- **连带修订**:§6.1/§6.2 的「不改 Rust」「可选 hook」表述全部按所选方向改写;走法 B 的「小改面」宣称需重新量化。

---

## 2. P1:边界与事实错误

### F4 · `kernel/memory-protocol.ts` 违反「单插件语义不入 kernel」

- **位置**:§3.4。
- **问题**:AGENTS.md §1 明文「单插件语义不入 kernel」。MemoryBackend 的唯一实现方与唯一消费方都是 memory-coordinator,当前无第二个插件消费此契约。
- **修订**:契约先放 `src/plugins/memory-coordinator/protocol.ts`;出现第二个消费者(如未来 workspace 插件要读 memory)再上提 kernel,并在上提 commit 里注明先例。

### F5 ·「17 个 cli-* 插件」计数错误

- **位置**:§3.3 准入注释。
- **问题**:cli-* 插件为 **8 个**(cli-omp / cli-pi / cli-codex / cli-claude / cli-grok / cli-kimi / cli-qoder / cli-qoder-cn,目录清单实证);17 是插件总数(8 CLI + feature/core)。
- **修订**:注释改为「8 个 cli-* 插件既有先例」;§3.1 图注同步。

### F6 · §4.3 session 路径引外部猜测,自家代码已有真值

- **位置**:§4.3 表格。
- **问题与证据**:
  - claude 行写 `~/.claude/projects/*/sessions/*.jsonl`——**错**。真值在 `src/plugins/cli-shared/qoderSessions.tsx:5`:「会话存储:<dataDir>/projects/<slug>/<uuid>.jsonl(claude 同构布局)」,即 `~/.claude/projects/<slug>/<uuid>.jsonl`,无 `sessions/` 层。
  - codex 行写 `~/.codex/sessions/**/*.jsonl`——粗对但缺真值细节:`src/plugins/cli-shared/quota/codexLocal.ts:5` 实证为 `~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl`(日期分层 + rollout 前缀)。
  - qoder 真值:`<dataDir>/projects/<slug>/<uuid>.jsonl`,国际版 `~/.qoder` / 国内版 `~/.qoder-cn`(qoderSessions.tsx 双分发共享内核,实证 2026-09-02)。
- **修订**:§4.3 全表改为引用 cli-shared 源码事实,外部猜测删除;「待 PoC」仅保留 grok / kimi 两家(session 路径在现有代码确未覆盖,grok 只有 config.toml 知识)。

### F7 · `cli-shared/memory/` 准入擦边

- **位置**:§3.3。
- **问题**:jsonl 读取 / 身份仲裁知识**已在** cli-shared(diskSessions、sessionIdentity、qoderSessions、piFamily 等),无需新增;真正新增的 session-tail(增量监听)当前只有 memory-coordinator 单方消费,按准入标准应先放插件内。
- **修订**:§3.3 缩为「复用既有 cli-shared 知识清单」;session-tail 移入 `memory-coordinator/adapters/`,出现第二个消费者再下沉。

---

## 3. P2:设计缺口

### F8 · 装机冲突未讨论

Magic Context setup 会**禁用 omp 原生 compaction 与 automatic memory**(上游 README 明文)。用户若已配 mnemopi / hindsight backend,安装即被覆盖;§5.1 表格第一行「已支持 CLI 主动 retain(model 调 tool)…我们只观察」在该状态下可能不成立(原生 memory 工具被禁用,保留/注入全走 Magic Context)。spec 必须补:检测既有 backend 配置 → 提示冲突 → 迁移或放弃的决策树。

### F9 · G1 时序竞态无 SLA

「session close 异步抽取 → 写库」与「新会话首 turn recall」存在竞态:用户关 A 会话立刻开 B,抽取可能未落库,首 turn miss。应对照 identityWatch 的 fast/cruise 两相模式定义:close 即触发 fast 抽取,启动时 cruise 补扫兜底;G1 验收需写明允许延迟上界。

### F10 · 隐私面扩大未披露

fact 抽取(无论 historian 还是自调模型)会把 session 内容发给 LLM provider——用户跑 claude code 的会话可能含密钥/私有代码。§9 只覆盖「本地 SQLite 明文」,没覆盖「抽取时外发」。需:设置项默认关 + 面板显式披露 + 按 CLI / 按项目开关。

### F11 · SQLite 并发写策略缺失

Magic Context 进程与 tmd-cli adapter 同时写同一库文件:SQLite 锁(WAL 与否、busy_timeout)未设计;§4.4 只写「失败 retry」。PoC-1 应加一条:双写者并发压测。

### F12 · 一键启用过于激进

§7.1「settings UI 点击 [一键启用] → 后台跑 npx …」——静默装第三方 npm 包 + 改动用户 omp/pi 配置(禁原生能力),须:显式 diff 预览(将改哪些文件/配置)、node/npx 可用性检测、失败回滚说明。

---

## 4. P3:小问题

- **F13**:§8.4「100 次重复输入后 count 增长 < 5」——dreamer 是夜间/手动跑,即时 count 必然先涨;验证脚本须在跑 dreamer 之后再测。
- **F14**:`routes/` 目录命名不合插件惯例——现有 cli-* 插件为扁平 `index.tsx + edits.ts + quota.ts` 结构,无 routes 概念;建议改 `engines/` 或扁平化。
- **F15**:文档归属——设计主体(§3–§7)按落盘铁律最终应转 `docs/superpowers/specs/` 四段式 spec;research 版定位为调研+草案可以,但状态流转要在文内写清。
- **F16**:G3 缺验证方法——应加「杀 Magic Context 进程 / 移走 SQLite 后,session/composer/approvals 回归通过」的显式步骤。
- **F17**:§5.3 引 terminalInputGate 作论据属张冠李戴(那是回放历史字节时 DA/OSC 应答问题,与 prompt 注入无关);结论(不走 PTY 流)对,论据需换。

---

## 5. 顺带发现的正资产(设计稿未利用)

- `src/kernel/settingsRegistry.ts` 已存在——设置分区注册有现成机制,§3.2「设置面板新增分区」应指向它,而非自造。
- `cli-shared/skillDirs.ts` / `mdCommands.ts` 已扫 claude/qoder 的 commands/skills 目录——未来读 Magic Context managed-skills / 治理 UI 可复用。
- 右栏面板已有注册化机制(2026-09-04 评审落地「面板 subbar 注册化」)——MemoryPanel 挂载走注册面,方向对,spec 里点名即可。

---

## 6. 修订清单(转 spec 前必须完成)

| 编号 | 必改项 | 归属 |
|---|---|---|
| F1 | 注入面改 context file / Magic Context 自带注入;删 prompt.ts 引用 | 重设计 |
| F2 | 抽取改走 historian / proc_communicate,消除 §1.4 矛盾 | 重设计 |
| F3 | SQLite 读取定 Rust 原语 vs 子进程,重写 §6「小改面」结论 | 重设计 |
| F4 | memory-protocol 下沉插件内 | 边界 |
| F5 | 插件计数改正(8 cli-* / 17 总) | 事实 |
| F6 | §4.3 路径表改引 cli-shared 源码真值 | 事实 |
| F7 | session-tail 移插件内,cli-shared 缩为复用清单 | 边界 |
| F8–F12 | 冲突决策树 / 时序 SLA / 隐私开关 / 并发写 / 启用确认流 | 补设计 |
| PoC 清单 | 加「双写者并发」「context file 注入实测」「historian 抽取实测」三项 | 验证 |

修订完成、P0 全部消解后,按四段式转 `docs/superpowers/specs/2026-09-05-memory-coordinator-design.md` 再评。
