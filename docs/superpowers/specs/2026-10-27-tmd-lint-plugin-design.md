# tmd-lint 插件移植设计(独立工具收编进 tmd-cli,判定改 AI 语义判断)

- 日期:2026-10-27
- 状态:已落地(前端全链门禁绿;真机交互目检待办:面板打开/体检/下钻/写回四步)

## 背景与目标

独立工具 tmd-lint(~/code/AI/github/tmd-lint,Tauri 应用,约 6k 行 Rust + 2.9k 行 TS)做「对话日志体检规则文件」:读本机 omp/pi/codex/claude 近 30 天会话日志,对 AGENTS.md 等规则文件逐条判定生效情况。它判定靠确定性阈值 if 链(纠正引文 ≥2 定罪 / 触达 ≥1 算提到),README 明写「零 AI 调用」——阈值链对共现统计诚实,但对「这条规则到底有没有生效」这种语义问题天然粗糙。

本次把该能力收编进 tmd-cli 成为一个插件(`src/plugins/tmd-lint/`),并把「规则是否生效」的判定改为 AI 大模型实时语义判断:证据测量保持确定性(可作为特征包),定罪与生效与否交本机 CLI 一次性 print 会话跑模型,证据原文随包附上供核对。同时面板与 memory-files 面板(截图所在处)同组并列,体检目标直接复用各 cli-* profile 的 memoryFiles 声明,不再自建路径表。

## 方案取舍

**选 A(选定):独立插件 tmd-lint,判定走 CLI 一次性 print 会话(prompt-enhancer 同款范式)。**
理由:新增 UI 能力的标准路径就是新建插件 + allPlugins 一行;tmd-lint 工作流(扫描→AI 判定→分诊→写回)与 memory-coordinator 的池/蒸馏/安装职责无交叠,塞进去会破坏后者「零直写、AI 全在官方管线」的 plugin 铁律叙事;引擎范式 prompt-enhancer 已实证 8 家 argv 表(2026-09-21 逐家 --help),session_spawn + pty://out 流式 + 哨兵提取是仓内已验证的 AI 通路,不引任何新依赖。

**否决 B:并入 memory-coordinator 插件。** 两插件都管「规则文件」但语义不同(发现/跳转 vs 体检/写回);memory-coordinator 头注自缚「本插件零直写」,而体检写回必须写盘,并入即违反其自身铁则;且单插件体量翻倍。

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
