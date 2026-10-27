# 33 · tmd-lint 规则体检契约(AI 语义判定)

规则文件体检(独立工具 tmd-lint 收编,spec 见 `docs/superpowers/specs/2026-10-27-tmd-lint-plugin-design.md`)在仓内立下的可复用结论:

## 插件如何合法地做「AI 大模型调用」

- 唯一范式 = 本机 CLI 一次性 print 会话(`ipc.sessionSpawn` + `pty://out` 流式 + 结束哨兵提取 + 自归档磁盘身份),argv 实证表以 `prompt-enhancer/enhanceEngines.ts` 为单一事实源,复刻方(现:`tmd-lint/aiJudge.ts`)注释声明同源、改动两边同步。
- 跨插件批处理成本控制:一次 spawn 判一批(8 条),不逐条 spawn;哨兵包裹 JSON 数组,解析逐项验值域,坏项跳过不连坐,整批失败如实标失败不回落猜测。

## 会话语料采集的适配器纪律(新先例)

- feature 插件需要「跨引擎全量会话语料」时,不得自扫 `~/.omp` 等私有目录;走 `host.getCliProfiles()` 的声明面:`listSessions`(cwd 检索)→ `readSessionFileIdentity`(cwd 自证,全等过滤,无身份即弃)→ `readSessionTranscript`(块化消息/工具调用)。tmd-lint/corpus.ts 是首个全量消费三家声明的先例;净化口径(系统注入过滤/长度门槛)随采集落地。
- 采集刻意顺序遍历(sessionIdx 确定性 + 有界 IPC),`doctor.config.json` 对该文件豁免 async-await-in-loop,同 sessionHead.ts 先例。

## 七态判定的分工(确定性 vs 语义)

- 确定性先行,不烧模型:机器把关(pre-commit 含规则命令=硬事实,直接判 working)、已拍板(指纹 `{来源态}|{文件}|{规则原文}` 存 app 侧 `tmd-lint.json`,不污染仓库)。
- 语义归模型:working/violated/touched/dormant/unverifiable 五态由模型按证据包(触达/纠正原话/照做引文/信号词可用性)实时判定;证据测量(IDF 区分度门槛 `max(5, 语料/2000)`、纠正词表刻意不含「不要」、命令归一 `run` 折叠)是纯特征工程,不定罪。

## 写回安全三件套(规则文件写盘的仓内口径)

- 先备份(每文件本会话一份 `.bak-tmdlint`)→ 行级原文匹配守卫(当前行 trim ≠ 体检时原文即拒笔)→ 破坏性动作过 ConfirmDialog;归档迁 `docs/agents-archive.md` 留占位符,连续归档块只留一个。
