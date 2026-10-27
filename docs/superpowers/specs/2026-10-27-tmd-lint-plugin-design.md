# tmd-lint 插件移植设计(独立工具收编进 tmd-cli,判定改 AI 语义判断)

- 日期:2026-10-27
- 状态:已落地(前端全链门禁绿;入口按用户裁决改为 memory-coordinator 记忆文件面板内嵌视图,不另起插件;真机交互目检待办:体检/下钻/写回三步)

## 背景与目标

独立工具 tmd-lint(~/code/AI/github/tmd-lint,Tauri 应用,约 6k 行 Rust + 2.9k 行 TS)做「对话日志体检规则文件」:读本机 omp/pi/codex/claude 近 30 天会话日志,对 AGENTS.md 等规则文件逐条判定生效情况。它判定靠确定性阈值 if 链(纠正引文 ≥2 定罪 / 触达 ≥1 算提到),README 明写「零 AI 调用」——阈值链对共现统计诚实,但对「这条规则到底有没有生效」这种语义问题天然粗糙。

本次把该能力收编进 tmd-cli,并把「规则是否生效」的判定改为 AI 大模型实时语义判断:证据测量保持确定性(可作为特征包),定罪与生效与否交本机 CLI 一次性 print 会话跑模型,证据原文随包附上供核对。落点(用户裁决,推翻一期「独立插件」方案):并入 memory-coordinator 插件,作为「记忆文件」面板的内嵌体检视图——体检目标直接复用各 cli-* profile 的 memoryFiles 声明(与该面板同一数据源),不再自建路径表,也不再新增 rail 入口。

## 方案取舍

**选 A(选定,用户裁决终版):并入 memory-coordinator,记忆文件面板内嵌体检视图;判定走 CLI 一次性 print 会话(prompt-enhancer 同款范式)。**
理由:用户明确指定落点 =「记忆文件」icon 面板;该面板的探测/三态/跳编辑器基建正是体检的目标清单(同一份 memoryFiles 声明),列表(发现/生成/跳转)与体检(判定/写回)是同一批文件的两个视图,内嵌最顺;引擎范式 prompt-enhancer 已实证 8 家 argv 表(2026-09-21 逐家 --help),session_spawn + pty://out 流式 + 哨兵提取是仓内已验证的 AI 通路,不引任何新依赖。一期曾按「新增插件标准路径」落成独立 tmd-lint 插件入口,被用户否决(多一个入口碎片化),当轮改内嵌。
写回与该插件「记忆面零直写」铁则的关系:lint 子模块只对规则文件直写,走 cli-config 同款备份+守卫口径,记忆池数据仍零直写;插件头注已注明此例外边界。

**否决 C:AI 判定走内置 HTTP 模型客户端。** 仓内零先例、要管 key 与代理,违背「AI 全在官方 CLI 管线」的既有共识;且 CLI print 会话天然复用用户已登录的引擎与配额。

**否决 D:移植全部五类发现与 history 恢复链。** 五类发现中「你反复在说」(missing)依赖 4 字滑窗覆盖判断与跨会话聚合,「引用失效」的自动同名搜索与 fixpath 依赖全仓扫描;一期先把七态判定(核心)+ drift/stale 两类静态发现做扎实,missing/hook 生成/history 恢复链留待二期(见「边界」)。

**判定协议细节**:每批判 8 条规则一次 spawn(控成本);判定取值裁剪为五态——「机器把关」由 .git/hooks/pre-commit 确定性先判(硬事实不烧模型)、「已拍板」由本地指纹折叠(移植 handled.json 但存 app 侧不污染仓库);AI 批次失败如实标「判定失败」,不回落阈值猜测(独立版教训:宁明说不知)。

**适配器纪律**:语料采集只走 host.getCliProfiles() 声明面(listSessions / readSessionFileIdentity / readSessionTranscript),cwd 全等过滤靠身份自证,无身份即丢弃——本插件零 CLI 私有格式知识,R1/R3/R4 全不过线。

## 验证

- `pnpm check:gate` 全链绿(file-size/arch-boundary/i18n 缺键 0 不对称 0/kernel-audit/typecheck/4686 测试全过/build)。
- `npx react-doctor@latest -y` 得分 100(复杂度拆 lintPanelState/ResultBody,顺序 IO 有豁免与并行化两种处理,busy 旗标进 finally)。
- 单测 23 例:规则提取(围栏/表格块/三通道信号词/命令抽取)、IDF 门槛与 unjudgeable、纠正词表不含「不要」、净化注入过滤、哨兵 JSON 解析(围栏/坏对象捞回/越值剔除)、删行守卫、引擎 argv 表对齐 prompt-enhancer 实证。

## 边界(与独立版的差异,有意为之一期不做)

- 五类发现只移植 violated/dead(并入七态)+ drift + stale;missing(你反复在说)与 fixpath 自动同名搜索留二期。
- hook 生成(pre-commit 预览)与 .tmd-lint/history 可逆恢复链不做;写回安全靠「.bak-tmdlint 先备份 + 行级原文匹配守卫 + ConfirmDialog」三件套。
- 用户级规则文件(~/.codex/AGENTS.md 等)与项目级共用当前工作区语料判定(用户级文件本就注入本仓每个会话,语义成立),面板会标注证据范围。
- 判定引擎默认 omp,可切 8 家与自填模型;120s/批判定超时,超时批如实标失败。
