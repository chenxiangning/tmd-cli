# 33 · tmd-lint 规则体检契约(AI 语义判定)

规则文件体检(独立工具 tmd-lint 收编,spec 见 `docs/superpowers/specs/2026-10-27-tmd-lint-plugin-design.md`)在仓内立下的可复用结论:

## 插件如何合法地做「AI 大模型调用」

- 唯一范式 = 本机 CLI 一次性 print 会话(`ipc.sessionSpawn` + `pty://out` 流式 + 结束哨兵提取 + 自归档磁盘身份),argv 实证表以 `prompt-enhancer/enhanceEngines.ts` 为单一事实源,复刻方(现:`memory-coordinator/lint/aiJudge.ts`)注释声明同源、改动两边同步。
- 跨插件批处理成本控制:一次 spawn 判一批(8 条),不逐条 spawn;哨兵包裹 JSON 数组,解析逐项验值域,坏项跳过不连坐,整批失败如实标失败不回落猜测。

## 会话语料采集的适配器纪律(新先例)

- feature 插件需要「跨引擎全量会话语料」时,不得自扫 `~/.omp` 等私有目录;走 `host.getCliProfiles()` 的声明面:`listSessions`(cwd 检索)→ `readSessionFileIdentity`(cwd 自证,全等过滤,无身份即弃)→ `readSessionTranscript`(块化消息/工具调用)。memory-coordinator/lint/corpus.ts 是首个全量消费三家声明的先例;净化口径(系统注入过滤/长度门槛)随采集落地。
- 采集刻意顺序遍历(sessionIdx 确定性 + 有界 IPC),`doctor.config.json` 对该文件豁免 async-await-in-loop,同 sessionHead.ts 先例。

## 七态判定的分工(确定性 vs 语义)

- 确定性先行,不烧模型:机器把关(pre-commit 含规则命令=硬事实,直接判 working)、已拍板(指纹 `{来源态}|{文件}|{规则原文}` 存 app 侧 `tmd-lint.json`,不污染仓库)。
- 语义归模型:working/violated/touched/dormant/unverifiable 五态由模型按脚本测量判定——只发规则原文 + 计数(触达/纠正/工具级照做)+ 「词面不可用」行标,对话原文/引文/信号词不出本机;证据测量(IDF 区分度门槛 `max(5, 语料/2000)`、纠正词表刻意不含「不要」、命令归一 `run` 折叠)是纯特征工程,不定罪。信号词缺失(含规则提不出任何信号词的纯中文条款)一律 unverifiable;模型判定落表前过 `enforceVerdictContract` 契约闸——dormant 需与 `scriptVerdict` 阶梯一致(全零+词面可用+有语料,否则回落阶梯值),violated 需纠正>0,working/touched 计数全零时落 unverifiable(风格/宪法型规则照做不留词痕,零词面痕迹不构成「没人用」的证明)(2026-10-28 实证:258 条全局哲学条款 217 条被误判 dormant——125 条提不出信号词、26 条词面不可用、10 条有触达仍判;批判定批路径随单次调用收编删除)。判定调用超时上限 1200s。

## 写回安全三件套(规则文件写盘的仓内口径)

- 先备份(每文件本会话一份 `.bak-tmdlint`)→ 行级原文匹配守卫(当前候选与体检快照都由 `extractRules` 同一提取口径生成,快照不得二次剥列表标记,普通段落/围栏示例不参与锚定;内容不一致即拒笔)→ 破坏性动作过 ConfirmDialog 且弹层带行级 diff 预览(diffUtil 首尾公共行修剪口径);归档迁 `docs/agents-archive.md` 留占位符;hook 生成走命令守卫 + procCommunicate chmod 通用原语;备份可恢复,已拍板可重开。
- 大仓语料采集必须带时间预算与逐会话进度(全量顺序读在千会话仓会假死);插件私有持久化一律 `ipc.configDir()`,禁 `configHomeDir()` 自拼。

## 闭环交互契约(二稿增补)

- 单次调用 AI(用户裁决:一次体检 = 1 次模型调用,取代早期识别/判定双 pass 与 8 条一批批判定):全部规则+脚本测量一行一条(unjudgeable 行带「词面不可用」尾标),一次回全部 识别标记(ok/why/fix)与最终判定 v(哨兵 `<JUDGE>`),指令携带判定铁律;解析为空重试 1 次,缺行如实标未判定不猜测;判定落表前过 `enforceVerdictContract` 契约闸。引擎级失败 fail-fast 并亮因。
- 增量上屏:流水线以事件回调打补丁(lintController 单例快照),右栏视图与中央报告 tab 同源生长;新 tab kind 注册必须同步 `tabContent.contract.test.ts` 的 OPENABLE_KINDS 镜像(死注册会被契约测试拦下)。
- 每次应用记 `ApplyRecord`(before/after 全文,lintStore.applyJournal cap 40),每次扫描记 `ScanRecord`(cap 12);撤销=把 before 写回并再入日志。
- 语料一次采集双口径分束:`sessionCwds` 记每会话 cwd,项目规则只计 cwd 全等会话,全局规则计全部——不再为两口径采两遍。
- 运行态(2026-10-27 三稿):右栏 LintView 切实时 PTY 幕布(LintCurtain,数据 = progress.live 尾窗 4KB,只上屏不加工);中央报告 tab 切 LintProcessing(进度条 + 按文件规则行四态:已提取·待测/识别中/判定中/已判定 + 当前批次脚本测量摘要);新跑 startLint 即 `result: null` 清旧结果,行从零逐个生长(旧结果混入新跑的重复行已修)。
- 运行态闭环补强(2026-10-27 四稿):① 幕布 = 脚本事件流(controller `logLine` 打点 start/script/evidence/recognize/judge/static/done/error,带时间戳 cap 240,与引擎 PTY 缓冲无关必实时)+ 底部 56px 引擎原始输出尾窗——omp 等缓冲型引擎批末才吐字也不空屏;② 右栏发起体检自动 `openLintReport()`,中央即切运行态,不依赖用户手点;③ 报告页规则行 `<details>` 展开即联动右侧 `RuleDetailPanel`(识别/判定说明 + 脚本测量摘要 + 改写 diff + 应用 AI 建议/保持并拍板/打开)。
- 运行态交互(2026-10-28 五稿):controller 增加 `runMeta`,中央与右栏必须展示同一次运行的引擎/模型;运行中选择器锁定,启动/应用按钮暴露 busy。幕布状态只能按 `running/error` 推导运行/失败/完成;事件日志贴底才自动跟随,上翻暂停并显示「回到最新」,不得用心跳更新抢回阅读位置。中央进度使用真实阶段与判定计数,加载区提供 `aria-busy`/`progressbar`;颜色走 `--tmd-*` 语义变量并遵守减动效。右栏入口统一为「AI配置管理」。
