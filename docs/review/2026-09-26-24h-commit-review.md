# 24 小时提交全量评审(2026-09-26)

- 日期:2026-09-26
- 状态:已完成,发现的问题当轮全部修复
- 范围:2026-09-25 15:43 ~ 2026-09-26 15:25 共 44 个非 merge 提交(fbbd06a..4b803bc)
- 方法:12 路并行审查(按功能区切片),五维度逐项取证;所有 P0/P1/P2 由主审对源码二次核实后修复;修复后全量门禁复验

## 结论

五维度总体干净:R1/R3/R4 零违规,PTY 幕布零二次渲染,CLI 私有格式全部经适配器面,插件注册面无绕过。真问题集中在三类:

1. **发送/载荷契约**(f27d579 直写 \n 违 PTY 发送契约 = P1;9d2a9e4 拍照载荷撞 3.5MiB 桥守卫 = P1;96a8a86 iOS 文件面板用错 SDK API 原生壳编译不过 = P1×2)。
2. **浮层壳惯例**(z-1000 裸浮层 + 捕获层死代码 + Esc 失焦失效,session-search/session-relay/worktree/search 四处同病)。
3. **i18n 欠账**(约 60 键漏 en/ja 词典:worktree 23 键、academy 31 键、exit-toast 3 键、session-search 5 键、welcome 1 键;另有 4 处死键)。

修复后门禁:typecheck / vitest 364 文件 2964 测试 / check:arch-boundary / check:file-size / build / react-doctor 100 / cargo test 308 + clippy + fmt / Swift typecheck(iPhoneOS 27 SDK)全绿。

## 按提交分组(问题 → 修复)

### academy(12 提交)

| 提交 | 判定 | 问题与修复 |
|---|---|---|
| dd78bae | pass | kernel 课程注册面 = 合格跨插件契约(零 CLI 语义,sidebarActions 先例);omp 课程数据在 cli-omp/academy 合规 |
| d86e1b5 | 提交时有病已自愈 | 阶段 2 自带 2×P1+4×P2(快照死循环/练习桥陈旧闭包/死 token/<b> 字面/菜单共享),全部被 80554fb 修复 |
| 80554fb | P2→已修 | guideTab 示例 `key={ex.i}` 在 resume/model/compact 三命令内重复(bun 扫描实证 dup=3)→ key 改 `${ex.i}:${ex.o}` |
| f12e1ba | pass | 架构契约 15 登记合规(滞后到本提交才登记,P3 记录) |
| f48682d | 提交时有病已自愈 | 裸类 reset 特异性压死后置类,ef99134 以 :where 修复 |
| ef99134 | pass | :where 修复无新倒挂,护栏测试锁定 |
| 8d31dfb | pass | 11 条纠偏逐条与 omp 18.3.1 dist/cli.js 对质全中 |
| c1708c6 | P3→已修 | reduced-motion 块只盖 cursor,6 处 transition 未盖 → 扩为 `.academy-root * { transition: none }` |
| 54bed23 | pass | pi sourceVersion 0.84.1 落后本机 0.87.1(thinking/bug 两命令未收),二期版本失效提示已挂,P3 留观 |
| 5322d1b | P3→已修 | 删 lessonCount===0 守卫后裸除法可 NaN% → `Math.max(lessonCount,1)` 护底 + `Math.min(100,…)` 封顶(兼治课程重提 done 残留 >100%) |
| 4b803bc | pass | 40 文件逐一核对零夹带;九家课程全走 ctx.registerAcademyCourse;qoder-cn 无课程与 docs 口径一致 |
| 5ff8f5d | pass | — |

### session-search(8 提交)

| 提交 | 判定 | 问题与修复 |
|---|---|---|
| 4d559c7 | 提交时 P0/P1 已自愈;HEAD 3 项已修 | 启动即全屏常驻(8f33e03 修)/z-1000 泄漏(bcf458a 修)。HEAD 残留:①遮罩点击死代码+失焦后 Esc 失效(捕获层被 z-1201 容器整体遮蔽)→ 容器自靶 onClick + isComposing 闸;②页脚 Enter 空承诺 → 输入框 Enter 打开首条命中;③workspaceName 只切 `/`(Windows 整串)→ deriveWorkspaceName |
| d170a11 | 准入违规→已修 | sessionUsage 下沉 cli-shared 零 cli-* 消费,不合 AGENTS.md 准入字面(知识横跨 omp/pi/claude/codex 四家,单一家族无法持有)→ 修订 AGENTS.md 准入条文(≥3 家家族格式知识允许双 feature 联合消费,文件头声明先例) |
| 4d9a027 | P3→已修 | ⌘O 无活动工作区时 overlay 置开但渲染 null,「隐形卡开」→ run 内 getActiveWorkspace() 闸门 |
| bcf458a | P2→已修 | 声称的遮罩点击关实为死代码(同上①);house search 同病 → 同修 |
| 8f33e03 | pass | open 闸门核实真实生效 |
| 8eb5ecd | pass | 循环健壮化无死循环/丢索引;提交信息对 prime 零作业路径描述夸大(原实现一拍后自愈),P3 记录 |
| c340d77 | P2/P3→已修 | 两新键漏 en/ja → 补;prime 失败与真零作业不可区分(违「真机故障定位」目的)→ collectJobs 计数 listFailed,零作业时四态分流 |
| 1fe5c30 | P3→已修 | 注释承诺「每 60ms 一会话」但 setInterval 不等上一拍,大文件多拍并发在途 → 改自调度 setTimeout 链 |

### sessions(3 提交)

| 提交 | 判定 | 问题与修复 |
|---|---|---|
| fdb54f0 | 提交时 P0 已自愈;HEAD 2 项已修 | 双重 remove 吞退出码(96a8a86 修复,复核属实:提交时点每次退出都弹假警报)。HEAD 残留:①3 键漏 en/ja(common 域)→ 补;②events.ts「130=信号中止」注释与 portable-pty 实测不符(信号死亡归一 1,kill=null)→ 正注 |
| f27d579 | P1/P2/P3→已修 | ①直写 `summary+"\n"` 违发送契约:LF 不被 TUI 当 Enter,整串突发触发粘贴启发式吞提交回车,omp/pi/kimi/codex 全部「首发不成立」→ 改走 composer 同源 prepareSendPayload(trigger 翻译+bracketedPaste+CR);②z-1000 裸浮层无 Esc → z-1201+自靶关+Esc;③重试再 createSession 堆空会话 → createdRef 复用;④「取消」键跨域重复注册 → 删 |
| b2a7048 | P2→已修 | readopt 重锚路径吃不到 busyHoldMs 覆盖(活帧路径在渲染冻结期无帧可达,重载+冻结同时成立时 30s 窗假结算复发)→ readoptAnchor 增 busyHoldMs 参,hostSessionServices 传 profile 覆盖 |

### approval-inbox / review(4 提交)

| 提交 | 判定 | 问题与修复 |
|---|---|---|
| 4651c65 | P3→已修 | bootApprovalInbox 不返回清理(revoke 留幽灵订阅)→ offs 数组 + activate 返回 |
| 70aaf94 | P3→已修 | 8 项评审修复逐条核实为真;面板摘要旧键死数据 → en/ja 删 |
| 96a8a86 | P1×2/P3×3→已修 | P0 双重 remove 修复复核正确。①iOS 文件面板用 macOS API(WKFileUploadPanelParameters 在 iPhoneOS SDK 不存在,swiftc -typecheck 实证红)→ 改 iOS 18.4+ runOpenPanelWith + @available 分流,typecheck 零错误;②FilePanelRelay 局部变量被 weak delegate 释放,选图死锁 → 桥单例持活+finish 释活;③quotaWatch 桶键越声明(对有 resetsAt 窗口也逐桶再报)→ 桶键仅对无 resetsAt 快照生效;④退出文案绕开 notifyText 双份 → 改走单一来源 |
| eca3688 | pass | 漏网根因 = 收口漏跑 typecheck(非 tsconfig 范围缺口),流程教训记录 |

### notify / settings(2 提交)

| 提交 | 判定 | 问题与修复 |
|---|---|---|
| 8c08a44 | P3→已修 | 架构面全过(R3 唯一 import 点/Rust 四处齐/契约/注册面)。提交时 3 缺陷已被 96a8a86 修。HEAD:①额度通知无失焦闸与设置描述「仅在失焦时发送」矛盾 → 补闸;②README 插件计数漂移(29/26/34 vs 实数)→ 按 category 实数回填(38 = 引擎 10+功能 24+核心 3+本机 1) |
| b5abe10 | pass | 并发写(persistChain 串行+失败补丁返还)/键删除/Rust persist_selfhost 互斥三问全核实成立,29 文件无夹带 |

### checkpoints(2 提交)

| 提交 | 判定 | 问题与修复 |
|---|---|---|
| 7873e78 | P2/P3→已修 | 主体正确(入账时机/anchor 基线/迟到守卫全核实)。①sd 带值旗标(-n/-f/--max-replacements/--flags)未建模,替换串被误记为路径(bun 实跑复现)→ 按原序定位位置参数,回归测试钉住;②空串替换式('' = 删除)错位吃掉首文件 → 修;③词内粘连重定向(echo x>out.log)漏 → redirectTargets 补词内分支;④「15 个 bash 改写文件」三处口径 vs 夹具实列 14 → 统一为 14;⑤pi 侧缺水位线回归钉 → 补。Windows 反斜杠宁漏 = 设计内,记录 |
| 876527a | pass(4 P3 留观) | .env.example 误伤/Makefile 宽网目/.npmrc 等缺口 = proposal 自述「按反馈增删」设计;BatchSheet 口径与实现不符 → proposal 已修(经共享 FileSections 两面同生效) |

### git worktree(1 提交)

| 提交 | 判定 | 问题与修复 |
|---|---|---|
| f619cf9 | P2×3/P3×4→已修 | ①23 键漏 en/ja(git 域)→ 补;②validateDirName 裸中文不经 t() → 调用点包 t+键入册;③porcelain 输出 canonical 路径 vs 工作区 root 输入前缀,符号链接场景主仓误判可移除/移除后工作区死条目(macOS /tmp→/private/tmp 实测)→ Rust rebase_porcelain_paths(主仓精确映射回输入+兄弟前缀回贴,双测试含真实 symlink);④无 Esc → GitConfirmDialog 同款;⑤列表加载失败伪装空态 → catch+fail;⑥分支前导 '-' 被 git 解析成费解报错 → Rust 校验;⑦force 死参数 = proposal 声明过的决策面,记录。盘根/移除联动两 P2 已由 96a8a86 先修 |

### mobile(2 提交)

| 提交 | 判定 | 问题与修复 |
|---|---|---|
| 9d2a9e4 | P1/P2/P3→已修 | 主链路干净(@注入 = 桌面既有约定,准入口径全过)。①拍照压缩后可超 900KB,JSON 数组 ~3.6 字符/字节撞 3.5MiB 桥守卫确定性失败(与 proposal「2-8MB 可承受」矛盾)→ shrinkImage 逐级降质/缩边压进 900KB 预算,proposal 风险表对齐;②提交时 typecheck 红 46 分钟(eca3688 已补);③失败只进设备侧 shell.log 手机屏零反馈 → 按钮 3s 变 ✕;④createImageBitmap 未传 imageOrientation(竖拍 EXIF)→ from-image+裸开兜底。临时文件无清扫 = 桌面同漏继承设计,记录 |
| eca3688 | pass | — |

### probe / welcome / kernel / app(7 提交)

| 提交 | 判定 | 问题与修复 |
|---|---|---|
| 5e3382b | P3→已修 | 跟链 16 级上限防环无测试 → 补 a→b→a 环链用例 |
| 72e3685 | pass | 纯搬移,300 行合规,模块头契约注释齐 |
| e032cbd | P2→已修 | commandUpdate = 合格声明制契约(零引擎字符串进 kernel)。新键「当前 {current}…」漏 en/ja → 补;旧键两变体死数据 → 删。busyHoldMs 字段塞进无关提交(提交卫生,P3 记录) |
| 40acff3 | pass | 契约文档两处与代码逐句一致 |
| 032b43f | pass | 双树装配恢复完整(桌面 IconContext+HintProvider,手机 IconContext;手机无 data-hint 面,不装 HintProvider 正确) |
| 6d58f55 | P3→已修 | 前端删除真零消费;Rust 侧 lsp://stderr 发射线程成死代码 → 改纯排空(防 pipe 缓冲撑爆卡死语言服务器),删 TextEvent,正模块文档 |
| fbbd06a | P2→已修 | execCommand 修复本身干净。8 处裸 navigator.clipboard.writeText 与「唯一原语」声明矛盾且同吃 WKWebView 拒写 → 全部迁移 copyText,仓库裸调用清零 |

### ci / docs(4 提交)

| 提交 | 判定 | 问题与修复 |
|---|---|---|
| ce8ee23 | P3×4→已修 | 门控逻辑正确。①secret 经 ${{ }} 内插进脚本(p12 密码引号/Linux base64 折行可打碎)→ env: 映射 + GITHUB_ENV heredoc;②单键判定与步名不符 → 六件套逐个核对点名;③proposal Android「如实未签」与仓内 keystore 自签事实矛盾 → 修;④README「手机端暂不随 Release 分发」陈旧 → 修 |
| 14b5686 | P1→已修 | 机理与并发防护核实全对;但 `gh api releases/tags` 对 draft release 恒 404,删 tag 重推(GitHub 转回 draft)场景清资产步打死、更新验签失败静默复发 → 改 gh release delete-asset(FetchRelease 双态命中) |
| 5af45ba | P3→已修 | 产物路径对;android job 头注释仍称 debug 未签 → 修 |
| 13538cd | pass | 登记 + 内容事实核验通过 |

## 修复面汇总

- 代码:SearchOverlay/search/index/RelayDialog/WorktreeManageDialog(浮层壳四统一)、bashWrites(sd/重定向)、activityWatch+hostWatches+hostSessionServices(readopt busyHold)、remote.ts+SessionScreen(预算闭环+可见反馈+300 行)、TmdApp.swift(iOS 文件面板)、lsp.rs、commands_worktree.rs(rebase+校验)、probe_prefix.rs(环链测试)
- 词典:welcome/session-search/git/worktree 23 键/academy 域词典新建 31 键/exit-toast 3 键/删死键 9 处
- 文档:AGENTS.md(cli-shared 准入第三路径)、README(插件实数/分发句)、02-code-architecture(14 个文件)、3 份 proposal 口径、release.yml(draft 404/secret 注入/注释)
- 测试:worktree 回贴×2、sd 旗标/空串/粘连重定向×3、pi 水位线、probe 环链、hostSessionServices busyHold 透传断言

## 验证

- 前端:typecheck ✅ / vitest 364 文件 2964 测试 ✅ / check:arch-boundary ✅ / check:file-size ✅ / build ✅ / react-doctor 100/100 ✅(基线 worktree 复核:HEAD 起点 100,修复过程曾跌 91,终态回 100)
- Rust:cargo test 308 ✅ / clippy -D warnings ✅ / fmt --check ✅
- Swift:xcrun swiftc -typecheck(iphoneos SDK,部署目标 16.0)零错误 ✅
- 探针:bun 直跑 bashWritePaths 九形态复现-修复对照 ✅;react-doctor 基线经临时 worktree 隔离复核 ✅

## 遗留(留观,不修)

- 桌面临时上传文件(upload-*)无清扫:桌面/mobile 共同继承设计,需启动清扫面,超出本批范围
- checkpoints 敏感路径表 .env.example/Makefile 误伤面:proposal 自述按反馈增删
- pi 课程 sourceVersion 落后二期提示已挂;qoder-cn 课程二期记账
- `sd >| f` 分离形态经 lex 分段不可达(宁漏)
