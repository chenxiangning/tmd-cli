# 第十四课:与 pi 终极对比 + 实战综合 + 学习复盘

最后一课,把全系列知识串起来。

## 1. 21 块电池全景回顾

| # | 电池 | 对应章节 |
| --- | ------ | ---------- |
| 01 | Code execution w/ tool-calling(eval 内核回调 agent 工具) | 第一课 / 第十四课 |
| 02 | LSP wired into every write | 第四课 |
| 03 | Drives a real debugger | 第四课 |
| 04 | Time-traveling stream rules | 第九课 |
| 05 | First-class subagents | 第三课 |
| 06 | Advisor model | 第三课 |
| 07 | `/collab` 共享 session | 第十课 |
| 08 | Web search 内置 | 第七课 |
| 09 | 全 Rust 内置 | 第十四课(架构) |
| 10 | `/review` P0-P3 + verdict | 第三课 |
| 11 | Hashline 编辑 | 第二课 |
| 12 | GitHub is filesystem | 第十一课 |
| 13 | Memory the agent curates | 第五课 |
| 14 | ACP editor-drivable | 第十课 |
| 15 | Inherits 既有 rules | 第十一课 |
| 16 | `omp commit` | 第八课 |
| 17 | 16 个内部 schemes | 第十一课 |
| 18 | `conflict://` | 第二课 |
| 19 | `ast_edit` 预览 + Accept | 第二课 |
| 20 | browser / Electron | 第十三课 |
| 21 | computer 桌面控制 | 第十三课 |

(编号与上游 README 的 batteries 章节一一对应。)

## 2. 与 pi 的终极差异矩阵

| 维度 | pi | omp |
| ------ | ----- | ----- |
| **血缘** | 上游 | **fork + 21 块电池** |
| **语言栈** | TypeScript | TypeScript + Rust(~80k LoC 内核,README 口径) |
| **模型** | 一次一个 | **9 role 路由**(default/smol/slow/plan/commit/advisor/vision/task/tiny) |
| **多模型协作** | ❌ | ✅ 主 + advisor + subagent |
| **Fallback chain** | 手动 | ✅ 按 role/model/provider 通配 + 自动切回 |
| **凭据轮换** | ❌ | ✅ OAuth 多账号自动轮换 + auth-broker |
| **Path-scoped 模型** | ❌ | ✅(仅 enabledModels / disabledProviders) |
| **Provider 数量** | 较多 | **60+**(OAuth + Coding Plan + 本地) |
| **LSP** | ❌ | ✅ 14 actions,rename 走 willRenameFiles |
| **DAP** | ❌ | ✅ 28 actions,lldb/gdb/dlv/debugpy/rdbg |
| **ast_grep** | ❌ | ✅ ~55 种语法(默认关) |
| **hashline** | ❌ | ✅ `[PATH#TAG]` 快照锚 |
| **ast_edit** | ❌ | ✅ preview → `xd://resolve` |
| **conflict://** | ❌ | ✅ @ours/@theirs/@base/@both |
| **subagent** | prompt delegation | ✅ outputSchema 校验 + hub 消息 + 可选隔离工作区 |
| **advisor** | ❌ | ✅ 独立 context + nit/concern/blocker |
| **/review** | prompt | ✅ P0-P3 + verdict + confidence |
| **Memory** | 当前会话 | ✅ checkpoint/rewind + retain/recall/reflect + 5 backend |
| **Web search** | 需外接 | ✅ 23 provider + 站点感知提取 |
| **omp commit** | ❌ | ✅ message + changelog(原子拆分见 README 宣传) |
| **Stream rules** | system prompt | ✅ 触发才注入 + interruptMode + 抗压缩 |
| **/collab** | ❌ | ✅ 链接 + QR + view 只读,E2E 加密 |
| **ACP/Zed** | ❌ | ✅ `omp acp`,工具 I/O 协议级路由 |
| **浏览器** | ❌ | ✅ stealth + CDP + Chrome relay |
| **桌面控制** | ❌ | ✅ `computer` + 持久 JS(默认关) |
| **多模态** | ❌ | ✅ generate_image / inspect_image / tts |
| **继承规则** | 1 种 | ✅ 上下文 9 来源 + 规则 7 来源 |
| **内部 schemes** | 0 | ✅ 16 |
| **核心优势** | 简单、上游 | **功能深度、IDE-wired、生产稳** |
| **核心劣势** | 缺能力 | 安装大、配置面广、学习曲线陡 |

## 3. 什么时候用 omp / pi / opencode

```
场景                          推荐        理由
────────────────────────────────────────────────────────────────
新手、上游同步、玩             pi          轻量、原汁原味
大重构、生产环境、IDE 集成     omp         21 块电池,稳
Go 项目、快速轻量             opencode    Go 实现,社区大
单文件 demo                   pi / opencode 都行
企业大规模、团队 sharing       omp         协作 + 记忆 + 凭据池
Web 全栈(JS/TS/Python)        omp         browser + web_search + 多模态
Rust/C++/系统级               omp         debug + lldb
前端原型设计                  omp         browser + computer + image
模型 routing 复杂              omp         fallback + 多账号轮换
要本地模型主跑                 omp / opencode  两者都行:omp 免 key 自动发现 Ollama/LM Studio
```

## 4. omp 的 Rust 内核回顾

```
packages/coding-agent/         ← TypeScript UI / agent 编排层
        ▼
packages/natives/ (@oh-my-pi/pi-natives)
        │  平台 .node 插件(5 平台,x64 另分 AVX2/baseline 两档)
        │
        ├── pi-shell 38k       嵌入式 brush bash · 持久会话(README 口径行数)
        ├── pi-natives 25k     N-API 表面
        ├── pi-walker 5.2k     并行 ignore-aware walker + scan cache
        ├── pi-iso 3.3k        workspace 隔离(apfs/btrfs/zfs/reflink/overlayfs/projfs/rcopy)
        ├── pi-ast 2.9k        tree-sitter + ast-grep
        ├── pi-voice 1k        音频 + Opus + WebRTC
        ├── pi-builtins        bash 内建 + 内置命令行工具(uutils/jaq 移植)
        └── pi-vcs             gitoxide + Jujutsu 的进程内 VCS(v18.0.9 起)
```

### 4.1 内嵌 shell 深度

brush(Rust 写的 bash 实现)就是 bash 本体,**会话跨调用持久**;grep/sed/ls/find/jq/fd/diff 等工具以 builtin 形式 in-process 跑,零 fork/exec(README 称 58 个,工具清单章节写 46,monorepo 表写 67——数字随版本漂移,机制不变):

```bash
# omp 内部跑
grep -rn "TODO" src/
→ in-process 跑,不 spawn /usr/bin/grep
→ 跨 Mac/Linux/Windows 行为一致
```

### 4.2 pi-walker 深度

```rust
// 单次扫描,scan cache 共享
// grep / glob / workspace / shell 四个消费方同一份缓存
```

`grep` 是例外:文件系统搜索不走缓存(保证新鲜);ast_grep/ast_edit 的目录发现有缓存(默认 TTL 1s)。

### 4.3 pi-iso 深度

```rust
// subagent 隔离工作区
// apfs/btrfs/zfs/reflink 下走克隆(写时复制,毫秒级)
// 普通文件系统 fallback 到 overlayfs / 递归复制
```

## 5. 实战综合:一个完整的 omp 工作日

```
[上午]
09:00  omp 启动,接到新需求
09:05  /vibe,让 director 调度
09:10  orchestrate:让 4 个子代理并行调研 4 个模块
09:30  ultrathink:核心算法设计
10:00  hashline 改 20 个文件(ast_edit 批量 + 几个手改)
10:30  omp commit:生成 message + 更新 changelog
10:45  /review:出 P0-P3,改掉 P0
11:00  push,开 PR

[下午]
14:00  CI 红 → /collab view 发给 reviewer 围观
14:30  reviewer 留言,inspect_image 看截图
15:00  流卡住 → /fresh 重置
15:05  lldb-dap attach 调试核心服务
15:30  write conflict://1 "@theirs" 解冲突
16:00  /review 复审:PASS
16:30  merge

[晚上]
20:00  retain "这项目用 bun,bun test 不用 jest"
20:10  learn 沉淀成 bun-project-setup skill
```

## 6. 学习路径复盘

```
第 1 课  启动 / 模型 role / 工具
        ↓
第 2 课  hashline / ast_edit / conflict
        ↓
第 3 课  subagent / advisor / /review
        ↓
第 4 课  LSP / DAP / ast_grep
        ↓
第 5 课  Memory 三层
        ↓
第 6 课  多模型 / fallback / 凭据
        ↓
第 7 课  web_search / site-aware
        ↓
第 8 课  omp commit / git 集成
        ↓
第 9 课  Stream rules
        ↓
第 10 课 /collab / ACP
        ↓
第 11 课 继承 / schemes
        ↓
第 12 课 /vibe / /fresh / keywords
        ↓
第 13 课 browser / computer / 多模态
        ↓
第 14 课 终极对比 + 综合 ← 你在这
```

## 7. 推荐下一步实操

### 7.1 立即可做(5 分钟)

```bash
# 1. 起会话再进 vibe 模式
omp        # 会话内输 /vibe

# 2. 试试 hashline
omp --tools read,edit "读 src/ 里随便一个文件,然后改一行"

# 3. 试试 web_search
omp "搜一下 omp CLI 最新特性"

# 4. headless 一发
omp -p "总结最近一次 commit 的改动"
```

### 7.2 一周内实操

```
1. 在你的项目里跑 /review,看 verdict
2. 配 retry.fallbackChains 接 GLM Coding Plan + Claude
3. 跑 /vibe 重构一个中等模块
4. 开 astGrep.enabled,用 ast_grep 找坏味道,ast_edit 一键改
5. omp commit 看 message 生成质量
```

### 7.3 一个月内

```
1. 配 mnemopi backend,retain 关键事实
2. learn + manage_skill 沉淀 5 个项目 skill
3. 在 Zed 里配 omp acp,日常用编辑器驱动
4. /collab 给同事,真协作一次
5. 每天瞄一眼 releases(见 releases.md),omp 迭代极快
```

## 8. 一句话总结

**omp = pi 的超集 + Rust 内核 + 多模型协作 + IDE 全接入 + 桌面/浏览器/多模态**

如果你只能记住一句:**pi 是文本世界,omp 把代码当 AST、把桌面当 shell、把模型当路由、把 session 当状态机。**

---

## 附录:文档目录索引

```
docs/research/omp-cli-course/
├── README.md                  总览 + 路线图
├── releases.md                最近版本解决的问题(基于 GitHub release notes)
├── 01-basics.md               启动、模型 role、31 个工具
├── 02-editing-revolution.md   hashline + ast_edit + conflict://
├── 03-smart-collaboration.md  subagents + advisor + /review
├── 04-ide-depth.md            LSP + DAP + ast_grep
├── 05-memory-system.md        checkpoint/rewind + retain/recall/reflect + skills
├── 06-multi-model-routing.md  fallback / 凭据 / path-scoped / /login
├── 07-web-search.md           23 provider + site-aware extraction
├── 08-omp-commit.md           omp commit + git 集成
├── 09-stream-rules.md         触发才注入 + interruptMode
├── 10-collab-acp.md           /collab + Zed ACP
├── 11-inheritance-filesystem.md 规则继承 + 16 schemes
├── 12-session-modes.md        /vibe + /fresh + keywords
├── 13-multimodal-desktop.md   browser + computer + image/tts
├── 14-final-comparison.md     与 pi 终极对比 + 实战综合(本课)
└── prompts/                   每课的用户视角速查
```

学习愉快。
