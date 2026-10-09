# 更新日志

本文件记录 tmd-cli 每个版本的变更,格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。
版本号与 Git tag(`vX.Y.Z`)及 [GitHub Releases](https://github.com/chenxiangning/tmd-cli/releases) 一一对应;
发版时在此追加小节,推送 tag 后 CI 自动构建并挂产物到 Release。

## [0.3.5] - 2026-10-09

本版主体 = 图标装饰扩编收口与打磨批:git/文件面图标全面纳管装饰、设置卡六域分组 + 名称检索;意图画布保存链事务化;mcp-hub 转圈与 reveal 口径两条评审 P3 收账。

### 新增

- 图标装饰纳管扩编(b42dfdb3/38e37a60/64fa4387):git 面板与文件树 11 个图标入口纳管(行内 hover 动作缺省色自 faint 提深一档),git 与文件面弹出菜单图标色随触发钮,差异视图工具与 worktree 区按钮跟进;IconSetTables 拆出 Lucide 独立表(iconSetTablesLucide)
- 图标装饰设置卡分组与检索(3b5f52af):46+1 键按界面域六组展示(通用/右栏面板/侧栏工作区/输入框/Git/文件树),名称或 id 大小写不敏感检索,零命中空态提示;清单拆件 iconDecorItems.tsx 守 300 行铁则
- 文件树 Git 着色开关改两态语义(a284d4d1/82c6231e):选中才吃装饰色,GitMerge 实心双图标切换,缺省浅蓝

### 修复

- 意图画布保存链事务化(426b313b):索引读取失败/超限不再留下「文档已落盘、索引无条目」的半写态,回滚本次文档写(覆写恢复旧字节、新建删除新文件,先核对盘上字节防覆盖并发 AI 导入);超限剥缩略图从逐条全量重预算 O(n²) 改为条目内嵌字节增量精确预算 O(n),最旧优先、够用即止
- mcp-hub 失败行转圈拆分(9cb579b5):转圈态从面板级改行内私有,多引擎同败时点任意行重试只转该行
- 文件管理器定位失败口径统一(c8df93e1):checkpoints/files/cli-config 四处静默吞改 console.warn,对齐 git 侧
- daily-journal 账本直写覆写(3ae8af98):json 落盘不经 rename,修 rename 撞名致账本九日滞留 .tmp

### 内务

- 真机验收单落盘(d611c9ba):手机 M2 尾项 + 外网三件套/读头 + 安卓四项与徽标 + 双实例/updater 四段 14 项(docs/brainstorm/2026-10-09-035-acceptance-checklist.md),M2 8.2 断连快照保留代码面核实勾账

## [0.3.4] - 2026-10-09

本版主体 = 多仓批量操作打磨与 24h 综合评审(记录见 `docs/review/2026-10-09-24h-commit-review.md`):批量推送对 Conductor 式无上游仓的语义修正、推送弹窗与聚合头部交互细化,评审三处 P1 全修。

### 新增

- 文件行号槽 diff 着色(ab1dbddb):文件详情编辑态行号槽按 worktree vs index 标新增/修改/删除,跟随文件树「Git 变更着色」总开关,编辑期标记随行漂移、保存对齐
- 全仓刷新钮点击保底转圈(5928a882):useMinSpin 计时核化,快动作也保证可见转圈反馈
- 变更过滤「展开全部目录」(5928a882/f8c342e9):变更树一键展开并补齐双语词条
- 批量推送弹窗失败日志行内抽屉(f4a50e27):失败徽标可点开展开完整 git stderr,复选框选中态着色强化,可推仓置顶排序

### 修复

- 批量推送无上游仓误判不可推(f4a50e27):Conductor 命名惯例分支(如 `chenxiangning/yokohama`)无 upstream 被整链判死——目标选择只看 ahead,行目标缺省 `origin:<branch>`,下发走显式 refspec 不再依赖上游;推送全部菜单项不再置灰
- 聚合头部仓库选择器(f4a50e27):多仓横向滑动改为选择器按钮 + 弹出纵向列表,对齐 Git 面板仓库切换交互;批量条与 RepoBar 两行头部互换(12ef1f01)
- 24h 评审三处 P1(fc74577b):useMinSpin 迟落定旧回调杀新点击停表致忙态永久卡死;useFileLineDiff 不归一工作区根路径,Windows 反斜杠根上行级着色整体静默失效;editorDiffGutter 替换行双 marker 块级叠放致红条越行错格
- 评审 P2 一批(fc74577b):批量执行器同 tick 双触发可双跑整批(ref 同步闸);行级着色 `full=true` 全文 patch 过 IPC 改 3 行上下文(标记集逐位等价);磁盘外变文件标记错色(diskTick 信号);AggregateReposView 贴 300 行铁则(行件拆出)

### 内务

- 评审记录落盘(docs/review/2026-10-09-24h-commit-review.md):13 提交分三片并行体检,5 真问题全修、10 项 P3 记录不修,架构/边界/性能/死代码四维全绿
- 补升 mobile 壳版本号:0.3.3 发版漏升 plist/project.yml 双源,本次随 0.3.4 一并补齐

## [0.3.3] - 2026-10-09

本版主体 = Git 多仓批量操作(方向 A:面板内聚合模式,设计探索与评审见 `docs/design/git-batch-ops-*.html` 与 `docs/superpowers/specs/2026-10-08-git-batch-ops-design.md`)。跨工作区统一拉取/推送不再逐仓切换。

### 新增

- Git 面板「本仓/全部」段控(47b1033d):RepoBar 行尾段控,本机工作区 ≥2 或当前工作区多仓时出现(单仓单工作区用户零变化);「全部」态 = 批量条(数字摘要 + 分裂下拉按钮组:获取全部/拉取全部/推送全部,菜单行带目标计数)+ 按工作区分组的全仓列表
- 跨仓批量执行(47b1033d/54769b02):有界并发 6 仓(前端并发池;repo 缓存锁同仓串行跨仓并行,重发 0.3.3 起并行),行级三态结果(✓合入 n 提交/⊘跳过原因/✗错误),失败可「重试失败(n)」,执行中可取消(在飞仓跑完未起仓标已取消),推送只推 ahead>0、无上游仓不显拉推行
- 多仓推送确认弹窗(47b1033d):左列仓勾选(分支两行全显 `⎇ 本地 → origin : 目标`,目标分支行内可改,改动蓝色高亮)+ 右列本次推送提交清单(按行内 ↑n 截齐)与选中提交文件详情(状态着色 + ±行数)+ 底栏推送标签/运行 Git 挂钩开关;弹窗层级 z-1201(DialogShell 加 zClass 参数,治右栏层叠穿透)
- 推送留窗看进度(4c28d56f):批量/单仓推送确认后不再即关——弹窗内逐仓转圈/✓/✗ + 底栏 `推送 n/m…` → 落定「推送完成(n 仓失败)」;进行中「关闭」= 假关闭后台续跑,聚合批量条「查看进度」重开续看(快照父层持有,重开不丢);单仓 PushDialog 同律留窗显回执
- 审批线文件行 hover 入口图标(bb598644):「打开文件」「打开文件位置」

### 修复

- 段控门槛放宽:单工作区多仓(如 ER-QI 一仓区 19 仓)也能进聚合视图
- 推送预览口径:远端跟踪引用缺失时前端按行内 ↑n 截齐,不再显示全量历史
- 弹窗目标分支编辑器 IME 守卫(组词中 Enter/Esc 不误提交);执行中禁跳仓防批次脱管;▾ 菜单坐标钳制防窄面板出屏;推送选项透传堵「重试失败」带陈旧分支覆盖
- GitPanel 语境解析抽 useGitPanelContext,react-doctor 84→100 分收口
- 0.3.3 打磨批(0508767d):历史行图标常显修正,死代码死配置清理

## [0.3.2] - 2026-10-07

本版主体 = 日常工作流整合三条焊缝(规划与两轮评审见 `docs/brainstorm/2026-10-07-0.3.2-*` 与 `docs/superpowers/specs/2026-10-07-marks-checkpoints-evidence-chain-design.md`):接力不失忆(W1)、标注×检查点存证链(W2)、昨日未完今日续起(W3);附 B 批测试补齐与竞态收口。

### 新增

- W1 接力不失忆(c78a5f67/151b687d):接力摘要改换源角色化转录(7 家 CLI `readSessionTranscript` 适配器全接,缺失显示 — 不猜测兜底),未发标注可随接力携带;摘要以芯片挂进目标会话输入框,发前可改可删,不直写 PTY;入口扩到会话 tab 右键「转到其他引擎接力…」与异常退出卡,命令 `session-relay.to-engine` 可改键
- W2 标注存证链(cf52122b):随发标注落检查点账本(`marksRefs` 旧账本缺省空数组零迁移),审批线批头显「标 ×N」;标注卡徽章三态派生(已发送 → 已生效/已回退,生效 = 非回退批 M 类 patch 老侧 hunk 与标记区间相交,渲染期 join 不落盘);「参与轮次」片反查跳批审阅单,回退联动降级;时间线节点显携带标注
- W3 昨日未完(1834411e):daily-journal 未完聚合面板(未查看窗聚合 + 便签勾选),文章会话引用 `[会话|HH:MM|引擎|标题]` 四段标记点击跳原会话

### 修复

- 竞态四向收口(cf52122b/33e1b46c):广播闸关不误带上轮随发名单;标注生效轮询切会话后打旧键;diff 缓存 LRU 与渲染 join 暖取互踩自旋;锚点重试窗口内代数守卫防轮序倒挂
- 会话转活双行瞬态(33e1b46c):磁盘行与活行按会话 id 去重,活行优先
- 跨工作区广播存证错根(9fb0a7ff 前收口):剥不掉 cwd 前缀的携带行整条丢弃,宁漏勿串
- mermaid 边标签渲染报错(b8ba7437):会话查看 normalize 对边标签裸括号补引号

### 内务

- B 批补测(33e1b46c):接力摘要 truncated 双旗叠加 / dsh fixture / overlay 往返
- 死代码清理(9fb0a7ff):PromptSentRange 死转发 re-export、DailyPaths 多余导出

## [0.3.1] - 2026-10-06

本版主体 = 打磨与体验:手机外网三件套(状态条/磁盘缓存回显/凭证自愈)+ 桌面性能天花板清账(多仓 git 批量/活转录增量尾读/意图画布每帧税与保存 I/O)+ 竞态与安全六向收口;主体来自 0.3.1 打磨池三轮落地(A/B/D + E/F + G,规划与留观记录见 `docs/brainstorm/2026-10-06-next-steps.md`)。

### 新增

- 手机 composer 状态条(a96412b4):输入框上方「模型 + 思考级 + 额度」常驻,claude/kimi 读取器下放纯模块供手机树消费,发送线 bracketedPaste 镜像桌面;额度窗口改显示已用百分比(3e52f5b8)
- 手机列表/详情/时间线磁盘缓存(d50b2983):外网二次进入瞬时回显,断线扫描波不毒化持久缓存
- 凭证自愈链(73b78b34/5f263070):hello 帧下发 lan/host 内网权威地址,桌面重启换端口手机免重配对;撤销与迟到 hello 写口竞态双断
- 侧栏嵌套仓 ignore(22a52c3c):工作区文件浏览器 ignore 前缀从单仓升级多仓拼接
- daily-journal 聚焦拍 TTL(17767cc5):失焦再聚焦置空扫描缓存,外部 CLI 落盘的标题变更收敛到「一次失焦窗」

### 性能

- 多仓 git status 批量(0883063a):新 `git_status_batch` 命令线程并行逐仓,文件树着色 N 次 invoke 归一单往返
- 活转录增量尾读(5359f501):session-viewer 活浮层改 `readTranscriptTail` 增量契约(残行回退对齐/轮转守卫),8MB+ 大转录不再每秒全量重读
- 意图画布三连(501ffe90/d2362717):onChange 每帧只存原始引用零 sanitize(O 全元素扫描挪保存时一次);保存带出写后索引条目免第三次全量读;保存回写不再回滚在途键入
- 状态小文件 mtime 闸(fc7d3f3f/b59a892c):kimi 私有缓存泛化 `cli-shared/stateFileCache`(grok 接入);grok summary / kimi config 状态巡航接尺寸闸,活跃会话稳态零内容重读,消外网 2s 全量传输
- ask 检测事件化(8722f220):手机他屏 ask 通知从 60s 轮询改 turnActive 下降沿驱动,审批提醒秒级

### 修复

- 账本跨实例 flock(2a545f95):checkpoints 账本全局锁文件跨进程互斥,双实例 rewrite+append 吞行根治
- 新建文件意图排队(a77d2053):切换工作区后立即新建从 400ms 定时器赌时序改为意图排队,树挂载即弹命名框,跨工作区强制排队防弹旧树
- quota 安全三向收口(840a320b):设备域白名单通道 `quota_vendor_fetch`(IPv6 mapped/ULA/link-local 谓词补全、重定向 DNS 复核 any-内网即拒、relay 分支同律)
- 手机竞态三连(1f0cd945/06928946):状态条与时间线迟到响应 seq 丢弃守卫;换桌面连接端点签名即时重拉;配对写口 credsRef 领先写;探针映射表全集守护(新引擎漏接线即红)
- SearchPanel 高亮错位(c1379246):İ(U+0130)类 lower 变长字符索引错位回退正则原文索引
- i18n 死键清理(1306f738):882 告警逐条核对,删真死键 12 项,动态可达 21 项证据保留

## [0.3.0] - 2026-10-06

本版主体 = 手机侧整批:会话时间线全程化(fs_read_range 通用原语 + offset 精确历史定位)、安卓壳能力对齐 iOS(选图/拍照/扫码配对/WS 隧道与心跳)、外网列表查询风暴三连根治(读头批量化/负结果缓存/视图节流+事件化重拉);附 structured-session 能力批(模型/思考级/引擎切换、follow_up 排队、断线接续、上下文用量与 / 补全)、设置入口迁左缘 rail、v0.2.9..HEAD 49 提交两轮评审收口(桥拆线、transcript 身份绑定、Git 屏竞态、pty 孤儿日志等)。

### 新增

- 手机会话时间线全程化(01cb1384/c9660325,spec 见 `docs/superpowers/specs/2026-10-05-mobile-session-timeline-design.md`):composer「+」面板第五格 → 底部 sheet 列本会话全程用户消息;新通用原语 `fs_read_range` 自尾向头分段渐进拉全程(384KB/段、64 段 24MB 护栏),任意条目可点跳转历史定位视图(offset 前后文快照,锚行文本匹配滚动);数据链 = cliSessionId 身份绑定 → 探长 + 分段 → cli-shared parser 分发,桌面内核零 CLI 格式知识;入口二轮挪输入条行内,加号面板回四格
- 安卓壳能力对齐 iOS(e4247dd6/603b9357):选图/拍照/扫码配对/WS 隧道接线与心跳保活全量补齐;TLS 系统校验回落、pin 归一、凭证单例、日志轮转与生命周期收口;启动器图标复用 Tauri 安卓图标集,通知小图标改纯白 alpha 矢量根治状态栏白块
- structured-session 能力批(577cbf38/e90e620a,spec 见 `docs/superpowers/specs/2026-10-04-structured-session-polish-design.md`):兼容 turn_start 帧名,落地模型/思考级切换、引擎切换、follow_up 排队、后台通知与断线接续;补上下文用量、/ 命令补全、草稿持久化与模型筛选回车选中
- 设置入口迁左缘 rail 底簇(f409d185):右缘⋯菜单高度随条目自适应;底格 logo 顺窗口弧打磨
- 欢迎页标题条恢复 GitHub 仓库 MIT 链接(00d8b1f1)
- web-access 配对链上下行贯通设备平台字段,设备表徽标按值渲染不再断言 iOS(ce388b40);配对扫码统一收口设备页,内外网卡不再出码(b5fd154d)

### 性能

- 手机外网列表查询风暴三连根治(调研见 `docs/research/2026-10-05-mobile-list-query-analysis.md`,评审见 `docs/review/2026-10-05-mobile-list-optimization-review.md`):① 会话读头批量化为单次 IPC(e6684728);② 读头负结果缓存 + 深窗批量化,根治标题缺失重试风暴,契约沉淀 architecture/02(0b4fd2fd/33340b41/9955c6e7);③ 视图节流停后台扫描波 + 会话注册表事件驱动重拉(e6087a6f),桥恢复即拉补链(f30ad52b)
- lsp peek 整文件读随生命周期缓存,行回填与预览共享一次 IO(0f72e366)

### 修复

- v0.2.9..HEAD 两轮多角度评审收口(评审见 `docs/review/2026-10-05-git59-multi-angle-review.md`):桥拆线释放挂起 openGate + 退避表用满 3000 档(fd42eebb);手机会话屏按 cliSessionId 身份绑定 transcript 根治同 cwd 多会话串台(0fef2c7e);Git 屏竞态序号闸与双行 patch 键 + 键盘收起兜底(a45f14d3);范围2提案四维复审收口——confirm 畸形 id 闸、WS 在途除账与前台探测守卫、composer 随宽量高、liveText 转义族四缺口(a6bf7420);批量读头 IPC 异型归一并删逐文件死函数(302ec060);安卓壳回前台拆线促重拨对齐 iOS(d79f1aa6)
- 安卓壳 WS 隧道拨号协议改写,java.net.URL 不认 ws/wss 致配对后永远连不上;放开 LAN 明文对齐 iOS 直连(d2290d40)
- 幕布:吞 DCS 探测串并按屏外语义截断缩列旧行;活流快照重叠剥离防差分重绘双喂;pi 目录探测拒绝回落修复手机 transcript(ccaca16b)
- structured-session 模型清单失败重开可重试且不再自触发循环拉取(ad869225)
- 桥臂 serde 契约防线:fs_read_range 参数结构体补 camelCase 并反序列化测试钉死(84bd2d97);fs/git 域补反向漂移防线,恢复被覆盖的 fs_read_tail_changed 白名单行(fe65b9b8/25653ef5)
- 时间线真机读取失败:读窗降 512KB 避响应帧膨胀撞壳上限,失败态附错误细节(8e86d7c4);超长消息 clipText 归一可达判定与跳转匹配,补 3 词条 en/ja 词典(1a4a239b)
- pty 日志文件创建与账本插表压后到 reader/writer 双获取,克隆失败不留孤儿(7c2ef16e);fs_temp 前缀判定改字节面防多字节文件名 panic(666bf035)
- git 远程降级断数据面空转,DirtBadge 补形状防御与失败回退(e515de27);远程树隐藏无效果的 Git 着色开关(adb1fc2e)
- 外壳打磨:左缘设置 logo 月牙缝/圆弧/底缝五连修(a4b6bfe7 等 6 笔);工作区齿轮环形动作组真实指针命中修复(c886e50f)

## [0.2.9] - 2026-10-04

本版主体 = 手机端对话链路整批重做(三态胶囊 composer + 选图/拍照上传 + 直连 WS 心跳保活),附 structured-session 启动降噪、部件帧治理与 dependabot 依赖批吸收;v0.2.8..HEAD 经三轮评审收口,tag 后追补手机首页卡片化、lsp 引用 peek 渲染与幕布假死第十一轮等一批。

### 新增

- 手机会话输入区三态胶囊重做(豆包式 composer,spec 见 `docs/superpowers/specs/2026-10-03-mobile-composer-redesign-design.md`):常态胶囊条 / 挂图卡 + 提示 chips /「+」四格面板(相册·切模型·检查点·快捷键)三态;面板收紧瞬时菜单(动作执行即收、软键盘弹起自动收、展开期键条让位);拖拽调高把手保真回归——钉高/双击回紧凑/落手记忆原样恢复;chip 填稿改换行追加不覆盖已打文字;样式随迁 mobile-composer.css
- 手机选图/拍照双入口:胶囊条 Images 相册 + Camera 拍照(新 iOS takePhoto 桥,相机权限前置闸免黑屏,拍摄解码挪后台);上传空白期补原图即时 pending 卡 + 转圈遮罩,上传中禁发送防图未挂完先发
- 手机快捷键条两行大键网格重排;发起会话抽屉与 sheet 基座打磨(把手/滑入动画/关闭钮进基座,工作区整行选中与引擎双列卡片,样式拆 mobile-sheet.css)
- 手机首页卡片化重设计与会话名/外网连接稳定性打磨
- lsp 引用 peek 与 hover 代码渲染打磨:lsp 域补 Prism token 配色映射治一片白,symRange 符号区间与高亮共存,右列表行 Prism 渲染(spec 同日)
- checkpoints 时间线节点 hover 增复制钮,一键复制该节点发送原文;两钮补键盘聚焦现身,修 meta 行注释漂移
- data-hint 支持 left 贴附放置,右缘 rail 悬停提示改抽屉式左滑
- 左缘工具 rail 与工作区显隐菜单落地:看板/市场/回首页迁左 rail,网络代理迁右 rail 底簇,侧栏顶簇收敛;工作区显隐菜单自定义侧栏工作区卡可见性;⌘±0 缩放键位接管(zoomCommands)

### 修复

- 直连 WS 双侧心跳保活根治图片首发送失败:桌面 15s Ping 同 relay 节拍 + iOS WsTunnel 15s sendPing/10s pong 超时自愈(ws.rs 拆 ws_ticks.rs)
- 手机实况屏三连修:2J/3J 改真擦除并原地 resize 根治新建会话头信息重复;resize 夹持光标列防 ?7l 界外覆写;实况 2 秒延迟治理(TurnsView memo 止血 + setLive 尾沿节流 + 写后触拍)
- structured-session 启动部件 notice 降噪:setStatus/notify/setWidget 装饰类聚合成一条 ×N 计数行原地刷新,真交互与未知 kind 维持逐条可见;cli-shared 部件帧数值 id 归一免挂轮,流内聚合/notice 块不再被权威落定截掉
- v0.2.8..HEAD 三轮评审整体收口:pong 死线感知在途大帧+按线分账+回前台探测、StrictMode 复位 useShots、发送在途图/稿/重试三保护(send 本体硬闸堵重试/键路绕行)、实况屏幽灵列与 ESC7-8 与 pending 三族对齐 xterm、confirm 数值 id 同型回传、setEndpoint 清算 pending、poke 重入闸、卸载在途 objectURL 即释、错误定时器单点管理、fs_write_temp 服务端闸+老化清理
- 依赖批吸收(dependabot 8 项 PR):npm 分组 16 项 + markdown-it 15 + mermaid 12,cargo 全锁刷新 + russh 0.63/tungstenite 0.29/webpki-roots 1.0/rand 0.10;破坏面适配(证书型 host key 指纹、RngExt、attrGet 收窄、移除 @types/markdown-it,rust-version 抬 1.85)
- 幕布假死第十一轮:泵侧后台慢拍降档 + 镜像 feed 互斥与卸载补种 + 幕布数据链停滞探针
- 手机活会话真名跨桶借全局磁盘索引,修 default 工作区兜底名永不解析
- 会话行 tok/s pill 口径与稳定性:分子按行型分派 + 轮种子 + 180s 剔停 + 近 5 对滑窗 + codex 双快照,治时隐时现与离谱低值(实测可显率 49%→100%,跳变 p90 19.4x→1.5x)
- web 桥 invoke 对并发帽快拒做阶梯退避重试,修浏览器态 boot 扫描风暴下工作区列表整面缺失
- 文件树 git 着色链对 status files 缺形做形状防御,防贡献组件三崩熔断致文件树与渲染整面消失
- lsp jdt 数据目录按 app 实例×工作区双键隔离并回收陈旧实例目录,根治双 jdt 共享 workspace 锁互等的语义跳转 60s 死等

## [0.2.8] - 2026-10-02

本版主体 = 客户端打磨四连批(任务 1 交互与 i18n / 任务 2 原生弹窗与主题适配 / 任务 3 设计系统收口 / 任务 4 原语长尾与模块精修,分级治理方案见 `docs/superpowers/specs/2026-10-01-client-polish-plan-design.md`)。

### 新增

- 六套 tmd 原创低饱和主题(dark 族石墨/黛蓝/橄榄暗调 + light 族云白/雾蓝/暖沙),默认浅色切云白、深色切石墨;dark 族仿 light 先例补 16 槽降饱和 ANSI 表,浅色族过 WCAG 3:1 对比度闸
- 设计系统 token 阶梯一次建齐(themes.css @theme 桥接 Tailwind 标准类,全仓字面量迁移):字号六档(正文定 12px)/ 间距 4 栅格六档 / 圆角五档 / 动效三档 + 两曲线;层次模型落地(浮层统一 popover+阴影、模态统一遮罩、选中 = accent-soft+600、hover 纯色),浅色三主题 mix 系数收紧对比度达标;状态三原语沉淀 kernel——Empty(图标+一句话+引导钮)/ Spinner(一份 keyframes)/ 错误契约三分(可重试失败 = 持久条+重试钮、瞬态失败 = toast、行内校验 = 红字),高频面接入;图标四档 rem 化、badge/等宽字轨/写死色清尾,prefers-reduced-motion 全局化
- 手机端打磨:本地通知前台横幅(iOS 壳补 willPresent,ask 等待确认/会话退出不再前台静默)、git checkout 破坏性操作换仓内确认 sheet、错误伪装空改错误信封分流(git 历史/diff/历史屏/看板/open-with)、enterSend 等交互收口
- i18n 全量 en/ja 词条补齐(词典三语对齐),新增 `pnpm check:i18n-keys` 键位校验脚本并入 CI 防线;术语八组统一(幕布/额度/探测/内网/切换/文件夹/工作树/看板),ja 硬伤清零
- omp 扩展精选表 2026-10-01 核对,新纳 billion-context 等 8 个热门;精选条目豁免目录上限并置顶,在线/离线同语义
- 文件操作条下放面板头工具条:新建/上传/刷新/更多四钮并一行,刷新入口唯一化

### 修复

- 守望自愈两轮收口(render-health):洪水降级加 3 分钟宽限——宽限耗尽后无视洪水强击 reload,根治自愈配额被洪水耗尽的永久冻结;击打加聚焦闸——后台/被遮挡窗口 rAF 暂停是设计内行为,不再每 15s 从别的应用手里抢焦点(真粘死由回焦探针接力检出)
- cli-dsh 幕布渲染错乱根治:钉行光标纪律(行渲染与光标落位分离)根治实时与重开两路错乱;会话采用按 writer-held 分流,非持有者转只读兜底;侧栏滤子代理并修 host 探针 401 误判
- 原生弹窗全仓清零:Tauri WKWebView 下 confirm 可能不弹窗直接放行(破坏性操作裸奔),confirm/prompt/alert 全部换仓内确认弹层/输入弹层/toast;六套新主题下破相与不可读面修复;cli-config 脏草稿不再静默丢弃;弹层键盘回路(Esc/Enter/role)补齐;设置面原生 select/checkbox 归位 StyledSelect/segmented
- 欢迎页次要动作降显与状态条分隔线收束;composer 输入区键盘焦点环压线与分隔线双轨收敛
- 撤下 pi-usage 精选条目(其 hasApi 依赖在 omp 18.4.8 装载失败);web 侧 safe_eprintln 补 debug_assertions cfg 消 release 裁剪孤儿告警;daily-journal 月条热力断言日期陷阱(1 日豁免分支掩盖真断言)

### 变更

- 视图保活统一「全挂载 + display:none + aria-hidden」:git 三视图/checkpoints 双视图/右栏面板切换回切不丢滚动,未访问面板渐进挂载,后台轮询按面板活性门控
- 会话 tab 收敛:行内 hover 只留 ×,view/pin/locate 收进右键菜单(带可用性门控);双 tab 溢出统一横向滚动 + 右缘渐隐;双击强删暗道移除,改两击武装 3s 回退
- 原语长尾收尾:裸空态/裸忙态/错误违例长尾接入三原语,截断文本批量补 title,加载文案统一「加载中…」前缀
- relTime 与日期格式归 kernel 单源(kernel/relativeTime.ts + DATE_LOCALES),mobile/intent-canvas/web-access 改引

## [0.2.7] - 2026-10-01

### 新增

- 幕布右上工具行(terminal.canvasRow 挂点):内核渲染行容器,幕布刷新钮收尾最右——点击 = 本会话幕布重建(xterm 销毁重挂 + 输出缓冲回放 + 强制 SIGWINCH 整帧重绘),PTY/CLI 不中断、其他会话不受扰;session-viewer「结构化幕布」切换钮(原「转录」浮标)并入同排,返回钮改名「PTY流」;行不设 z,不透明画布浮层开启时整行隐没——结构化视图页不出刷新钮

- 结构化会话(structured-session 插件 + proc_stream 通用原语):omp/pi `--mode rpc` NDJSON 子进程 token 级流式(thinking/text/toolcall delta 原地累积,message_end 落权威块,与磁盘 JSONL 同构),幕布|结构化双视图切换,审批卡(confirm 回路)直答,PTY 零涉及;proc_stream 四命令(spawn/write/kill/kill_all)+ `proc://stream/{id}/out|err|exit` 行事件,双 reader EOF 单一收割出口,boot 期 kill_all 清孤儿,内核零 CLI 协议知识(契约见 architecture/19)
- 会话查看器极简展示(默认开启):每轮工作过程折叠单组只留最终答复,答复正文不再折叠进思考组
- 手机会话 composer 加大输入框,支持选图预览挂载与把手拖拽调高

### 修复

- 界面卡死第三轮根治(并发工作洪水×渲染成本):三 omp 会话并发工作期 PTY 洪水约 120MB/h,keep-alive 隐藏幕布逐 tick 直写 xterm 把主线程顶到饱和(rAF 饿死触发吊销粘死,洪水未停时 reload 自愈立即再冻结,越自愈越卡);三件增补——洪水期(floodGauge 5s 滑动窗 >256KB 判据)守望 reload 降级 set_focus 退洪再愈、隐藏幕布实时字节 250ms 合帧写入(行重建降两个数量级,激活即冲刷)、PTY 泵聚合窗自适应 8→50ms(洪峰事件数降数倍,击键回显仍 8ms)

- 界面卡死第四轮(守望自身的盲区):洪水标尺改真滑动窗,跨桶边界间歇洪峰不再系统性漏检;rAF 守望健康期每 5s 心跳自证存活;壳侧新增独立心跳守望(窗口可见但 15s 无任何上报 = 深冻,页内自报线已死也照样进击),洪水判定改泵侧自计量(PTY 泵字节增量 5s >256KB)——webview 冻结后前端旗标不再可信,洪水闭环全收 Rust 侧
- 手机运行中区改读嵌套 activity 投影(turnActive||unread,与桌面 RunningZone 同律),修复桌面在跑手机恒空闲
- 手机发送改成功后才清草稿挂图,失败保留输入并提示重试;会话复制 ID 改走内核剪贴板原语,修 WKWebView 写入常拒
- 幕布隐藏期不再外发尺寸,自愈旗强制同尺寸重绘,根治切回重开错位
- daily-journal 入队闸改日粒度,防跨类型任务并发双写同一篇文章
- structured-session:启动失败收割子进程并加可重试按钮,cwd 改取激活工作区;piRpc spawn 未决废弃即收割消孤儿进程
- 转录浮层不可探测路径二次探错熔断终态,消无限重定位
- omp/pi skill 派发轮次接入时间线,判空标记同步防清扫误删
- v0.2.5..0.2.7 六维代码审查修复批:结构化流渲染 120ms 尾沿合帧(每 token 全量重渲染链降一个量级)与转录浮层块引用复用保 memo/定位扫描 miss 退避;piRpc 退出守卫补全(exited 置位——退出后审批应答/非 confirm 部件取消不再未捕获拒绝,在途请求统一 reject,启动相位回退守卫,发送失败回填草稿),补 piRpc.test.ts 回归;proc_stream kill/kill_all 改 async(spawn_blocking)防收割窗持锁冻主线程 2s;daily-journal meta 账本改同目录 tmp+rename 原子写;WSL 主机表单端口显式校验(1-65535,不再静默回落 22);手机 shrinkImage 位图显式 close 与 composer 高度上限钳制;删死代码约 -60 行(glyphOf 品牌分支与配套 CSS、wsl-distro 死类名、decideProbe 死参、hasActiveTaskForDay 预闸与导出、collectSessionRows 转发、WslDirBrowser 死联合臂、render_health gap_ms 双侧、render_health 头注/日志路径漂移)

### 变更

- WSL 三份同构目录浏览器收敛为单一 WslDirBrowser;远程段手动添加主机表单并入 SSH 簿(sshHostIdentityKey 沉淀 kernel/sshTypes 双消费);删 DEV_REMOTE_FALLBACK 假发行版数据(探测失败如实报错);删零消费 railEntry 字段
- daily-journal 删零消费 articleHead/scanning/holidays/since,todayKeyLocal 并入 daySessions;session-viewer 的 capped/TEXT_CAP 沉淀 transcriptPhases 去拆文件双份维护

## [0.2.6] - 2026-09-30

### 新增

- 每日工作日志插件(总述补录,代码已随 0.2.5 补发窗口落地、0.2.5 段漏记):日历日/月/年三视图 + AI 每日汇总文章 + 便签 + 生成任务队列 + 节假日关联;文章由各 CLI 会话转录预提取摘录改四点式事实成文,后台批量生成、生成会话终态全程无头收割
- 手动发起总结与增量并入:入口覆盖文章 tab 与月格全状态,补齐待生成不再只靠定时;单例热更自接受守卫根治镜像实例卡排队
- 生成无头契约扩展 oneshotStdin 管道递送,pi/codex/claude 三家声明落地
- 生成设置引擎按钮亮各 CLI 品牌 logo,增量策略三档描述按真实语义重写
- 年/月视图自适应占满舞台,月格改系统日历式白底细线格与 pill 状态条
- WSL 远程段手动添加主机表单并入 SSH 簿,目录浏览器图标化与样式按面拆分

### 变更

- 轴视图从中央 tab 迁右栏面板,月格状态行单行四态化,补面板与月格渲染契约测试
- Rust 清 clippy 1.98 新命中(ServerError 未用绑定改 `_`、outcome_state 收敛 if/else 表达式)

### 修复

- 生成会话改 omp -p 无头单发,根治 TUI 输出洪水饿死幕布(单任务探索风暴转录实测 3-8.6MB,用户会话渲染排队等不到);摘录增量分批治理
- 后台生成队列 run 态永久卡死根治:run 态 20 分硬顶、排队区「全部取消」、取消即收割生成会话放行后续、生成队列上调 3 槽并发;扫盘禁令提级进全部生成分支共用要求区
- 扫描提速:旧数据先上屏+分批追加渲染,活会话同步合并不等重扫,codex/kimi 读头加 mtime 缓存
- 月历热力改当月活跃日 25/50/75 分位动态分档,高强度月不再整月同色
- omp 无头生成加 --print-thoughts 思考流实时可见与 --no-extensions 静默扩展报错
- dsh 会话盘 v3/v4 版本号文件名通配定位,tool/result 兼容扁平形制,块 id 退 seq 兜底
- rail 入口互斥收敛右栏容器,skill/mcp/日志中央 tab 解绑可并存
- proc_run EOF 收割改先自然再杀树,根治 SIGKILL 把注定 exited(0) 的进程改判 signal 死的竞态(proc_run 测试 CI 三连红真因,非 runner 慢)
- 渲染粘死守望缺口补修(意图画布打开黑屏回归根因):hidden 恒粘的吊销态此前被看门狗静默跳过、只等 Rust Focused 事件再戳探针——窗口已聚焦时再无该事件,阶梯永久停在实测无效的首击 set_focus,黑屏永不自愈;改为 rAF 停发 ≥10s 一律上报,真伪可见性单一归 Rust `is_visible` 裁断(真隐藏/最小化仍不击打),粘死后 ~25s 内走完 focus→reload 阶梯自愈;配套 PluginBoundary 塌陷呈现从静默 null 改为就地可见错误条(渲染崩溃与粘死黑屏此前无法区分,现场无从留证)

## [0.2.5] - 2026-09-30

### 新增

- 图标装饰扩编 17→34 键:工作区行三钮(查看文件/会话管理/刷新会话)、顶栏四钮(插件市场/回到首页/折叠左右栏)、composer 工具条三钮(展开/收起对话框/命令与技能)与输入轨七钮(智能体/提示词/AI 作画/平铺广播/提示词增强/技能/MCP)纳入独立取色与呼吸闪烁;新键统一 `data-action-id` 图标钩子(缺省 currentColor 整图标着色),设置卡副标题同步两种着色语义
- 中央 tab 图标:registerTabContent 增可选 icon(顶栏 tab 徽标),skill-hub/mcp-hub/意图画布/memory 控制台/WSL tab 图标经 DecorIcon 跟随图标组合,git 三 diff tab/批审阅单/学堂/会话查看器补语义图标(GitCommit/GitDiff/ClockCounterClockwise/ClipboardText/GraduationCap/Scroll),非文件 tab 标题改显 title(此前露 path 兜底串);契约测试钉「非文件 kind 必带 icon」防回落默认文件徽标
- 图标组合切换:图标装饰卡新增五段切换——组合1 现状(圆胖 bold)/ 组合2 实心(同字形 fill)/ 组合3 换隐喻(逐键换 Phosphor 字形)/ 组合4 Lucide 细线 / 组合5 Lucide 细线变体;组合4↔5 切换经 morphicons 弹簧变形全表图标同时过渡演出(Phosphor↔Lucide 跨族切换跳变);34 键白名单渲染位全部接管(rail/设置菜单/顶栏/工作区行/composer 工具条与输入轨/设置卡预览),fold 双键为方向性 affordance 不换字形;每键自定义色与呼吸闪烁对五套组合全部正交生效;新增依赖 morphicons(MIT)+ lucide 数据包(ISC)
- 会话检索浮层键盘导航:↑↓ 移动选中(选中行高亮并滚入视野)、Enter 打开选中项(此前只能开首条)、输入即回顶;页脚文案改诚实「↑↓ 选择 · Enter 打开 · Esc 关闭」
- 审批收件箱拒绝引导:「直达」升级为直达并聚焦幕布(切激活 + xterm 聚焦,幕布未挂载静默);等待期面板常驻一行引导——允许/拒绝按该 CLI 自己的键位,收件箱只代发文本(不代发键,M2 评审 A2 边界变为用户可见)
- 审批收件箱 omp ask 卡结构化操作:右栏解析 select/multi 问卷卡(问题正文+选项+题目 tab),选项点击代发真实键序(select=移动+回车直选推进、multi=移动+空格勾选,键位语义取自 pi-tui ask-dialog 源码),题目 pill 代发 ⇥ 跳题,Submit pill 一键提交;多问卡在面板内逐题闭环,不再只显示尾流摘录
- 审批收件箱 ask 卡三缺陷修复(真机报):① 解析只取尾流最后一帧(光标寻址重绘把旧帧选项留在尾里,整尾解析命中旧题);② 日志尾拉取窗 2KB→64KB(整帧数 KB,旧窗把选项块切在窗外)+ 等待期 1.5s 重同步(卡态随 tab/光标演进不再滞后)+ 屏幕采样窗 8 行→24 行带贴底闸(静态卡标记在屏中部,旧窗够不着漏报);③ ask 历史落盘(localStorage 50 条环):行消退/重启后右栏仍可回看问过什么(问题+选项+时刻,指纹去重;**会话绑定**:只记当前正在查看的会话,历史区按激活会话过滤,跨会话不互泄)
- 异常退出卡接跨引擎接力:退出 toast 在「一键续聊」旁加「转其他引擎接力」,经 kernel 开框桥(relayBridge)送快照源进对话框;摘要走磁盘读取器,会话已退出仍读得到;新会话落位优先源会话工作区;接力插件停用即无钮(随贡献回滚)
- 意图画布插件:Excalidraw 白板(mossx 移植)——管理页时间分组/搜索/缩略图/批量删除,编辑器双栏(左元数据与结构化关联、右 AI Context 指标与来源追溯),画布可压缩成结构化 JSON 上下文附加到会话发送;新能力「对话中 AI 直接作画」:composer 左下会话级作画标识默认零注入,AI 产物经收件箱通道导入画布,作画标签绑定形状与分层布局提示词、箭头端点吸附节点边缘消穿越重叠,作画通知可点击跳转;配色收敛主题安全调色板,入口 ⌘⌥I
- skill-hub 插件:十家 CLI 技能扫描与统一安装记录闭环——ClawHub 商店/本地导入/商店安装统一写 installed-skills.json,已装视图带来源徽标与落位摘要,本地导入支持搜索过滤(技能名/描述/引擎标签);本地导入落公约位 ~/.agents/skills 并按引擎 symlink(.claude/skills 等);composer `$` 级联 = 安装记录∩当前 CLI profile 可用
- mcp-hub 插件:六家 CLI 的 MCP 服务器配置管理(写回走各 CLI 自己的配置文件并预写 .bak-tmd 备份),三源商店(官方注册表/ClawHub/导入桥),mcp_probe 探活;引擎导航收口右栏面板可点行
- 会话查看器插件:omp/pi/claude/codex/kimi/dsh 六族转录解析零 PTY 只读查看;会话行齿轮环形动作入口(查看/置顶/复制 ID/重命名,磁盘/活/置顶/运行四类行统一);思考链短语随组折叠降噪,纯问答轮还原全尺寸正文
- composer 输入轨新增技能/MCP 直达双图标,补齐 omp/kimi/grok/qoder 四家 MCP 发现
- 右缘 rail 与「更多」菜单激活面板可联动打开中央 tab(hub 双插件接入);rail 面板 icon 可逆开合折叠右栏,切换清残留中央 tab
- 界面功能插排细分为六子组(会话审批/文件工作区/引擎远程/网络Web/智能提示词/桌面辅助)并改横带布局铺满行宽,消竖列留白
- 设置图标装饰纳入审批收件箱/Skills/MCP/意图画布四键并改两列铺排
- 活会话行 tok/s 响应均速 pill:生成中的活会话行(运行区/置顶区/组内)2s 巡航尾读会话 jsonl,末两条 usage 行差分得响应均速(含排队与首字等待,偏保守),轮结束自动隐藏;codex 快照型单行无差分不显示(缺失不猜测兜底)
- 右缘工具条归组分隔与签名:按工作区/会话/机器/能力生态四簇归组分隔,能力生态簇与 ⋯ 钉底;底簇上方竖排手写签名 tmd-cli(深色银/浅色暗金)
- 会话查看器用户消息内嵌图片:omp/pi 与 claude/qoder 两族粘贴/内嵌图片解析并直接渲染;omp fileMention 独立消息行的粘贴图片并入相邻用户图片块
- composer 触发器候选支持子串任意位置匹配,前缀命中排前
- skill-hub 已装与导入视图接回详情抽屉,并新增编辑深链中央文件 tab
- SSH 主机编辑弹窗密码与私钥口令框加眼睛明文切换
- 会话查看器转录 md 正文补 mermaid 栅栏渲染与 katex 数学渲染(行内/块级定界与 math 栅栏,复用 files 预览管线组件)

### 变更

- 依赖升级批:npm 18 项、cargo 8 项 minor/patch、dirs 6→7、setup-java 4→6、vitest 4→5(大版本全套用例零改动通过);russh 0.63 试过不合入——MSRV 1.85 超本仓 rust-version 1.80 且 Handler::check_server_key 签名破坏性变更,推 0.2.6 配真连验证
- 内部治理:checkpoints 精准手术擦除拆出 surgical 模块、文件历史与接力发送两处跨插件直连迁 kernel、promptSent 轮次闸归 kernel;弹层 Esc 关闭、浮层视口夹取、逐级建目录、fnv 散列、git 可见性轮询等 17+ 处手抄版收口为 kernel/git 共享原语(净删 131 行);Rust 侧 now_millis 三合一、wsl 非 Windows 死码垫片删除、relay 手搓 urlencode 改 url::form_urlencoded(零行为变化)
- 安装包体瘦身:katex 单版本、excalidraw 语言裁剪、图标量化、手机壳 mobile-only dist、APK 开 R8、macOS 改分架构 dmg——universal 39.3MB 对半砍,单架构下载 26.6→约 14MB、更新流量减半;universal 客户端按 CPU 架构命中 latest.json 对应键

### 修复

- 手机选图在 iOS 18.4 前无法弹面板(WKUIDelegate 文件面板是 18.4+ 面,file input 低版本静默死钮):改为 ShellBridge 直连 PHPicker(iOS 14+),且 native 统一转 JPEG(≤2048px)——相册 HEIC 照片此前在 WKWebView 解不出,同样发不出
- dsh 引擎适配 0.1.7-rc.2 线格式换代:commands/execute 参数 images→submittedAttachments(斜杠命令此前全部被网关拒)、模式菜单端点 agentPreset.list→agentPresets/list(此前拉取模式列表失败);其余契约(launch token→cookie、typert 网关信封、remote.mux 双流、事件词表、审批/问答 waterfall)对 0.1.7-rc.2 真机逐项验证兼容
- 发布收口三轮评审(插件模块全量/Rust 二轮/Windows 专项)19+ 项:checkpoints 反悔守卫按路径取快照防误删用户文件、diff 缓存按会话键控防跨会话误清在看的批、账本原子追加与 kill 锁域收窄防全局冻结、memory 沉淀 reject 兜底与写链建目录、kimi 扫描先截后读、git 轮询值等守卫消非 git 工作区空转重渲、worktree UNC 归一与回贴随形、退出码 NTSTATUS 归一、代写指令改走 stdin、高危红标大小写不敏感等
- 会话与发送线收口:广播退化单发绑定计划快照内首个存活目标消活跃指针漂移、session-relay busy 期禁换引擎防在途击穿复用、写失败清死会话引用使重试可达、approval-inbox 写失败横幅不被重算自清且他路成功不清别家、multi 卡跳题按面板 tab 位跟踪防回绕误提交、QuotaChip 请求序守卫、退出卡接力钮消除裸非空断言
- 引擎侧二轮收口:dsh 适配器部署失败可重试、omp 预热停用闸、kimi 路径缓存直写、piFamily 远程列目录先截后传、代理浮层开合重置草稿
- 手机选图链路收尾:选图 provider 被 ARC 提前回收致回调永挂(持活修复)、失败不再静默当取消并写诊断日志、app 设备允许域放行 fs_write_temp 打通截图注入最后一环
- ask 镜像栅格对齐真实 PTY 与前后台全屏同口径采样,根治失焦漏检与改窗误摘
- 回到首页 toggle 不再记忆终端会话,再点不凭空开出终端
- dev 冷启动首开文件白屏/黑屏且文件树入口消失两轮根治:CodeMirror 全语言与 @uiw 钉入启动期预构建并归一 lezer 依赖图(消长会话跨 lock 变化的半截缓存撕裂);全部文件视图 lazy import 加 504 竞态指数退避重试护栏并空闲预取编辑器 chunk——React lazy 会把 dev 依赖优化期 504 永久缓存成白屏,重试链等优化完成即自愈,生产零影响
- skill-hub:ClawHub slug 收口白名单,挡注册表污染的安装目录逃逸与 URL 注入
- Ask 等待徽章双通道两修:屏幕态摘除补缺席防抖(消 4Hz 采样撞清屏帧的闪摘再复燃)、双通道并置摘除去短路残留(屏幕态与字节标记并置不再漏摘再挂窗)
- mcp-hub:首存即建父目录、商店拉取竞态序号守卫、quota 流式应答读体超时误报修复(SSE 探活不再 15s 假红;空闲窗与 2MB 上限仅对 text/event-stream 生效,普通 JSON 端点保持整读)
- 意图画布:作画 inbox 半截文件三轮重试防线与索引 496KB 体积闸超限剥缩略图
- 会话查看器:dsh 解压 32MB 字节预算截尾、同文撞号 key 去重与分批渲染 memo 稳定链
- macOS 分架构 dmg「已损坏」无法安装:thin 二进制上链接器残留 ad-hoc 签名触发 Gatekeeper 硬拦(universal 时代 lipo 使其失效反而走「仍要打开」软拦);bundler 现按 signingIdentity "-" 做全 bundle ad-hoc 封签,浏览器下载安装恢复「隐私与安全性 → 仍要打开」路径,无需证书零成本;此前已装用户不受影响,坏包重下即得
- 界面卡死(WKWebView 吊销粘死)根治:窗口隐藏/遮挡后恢复可见时 WebKit 偶发不再恢复渲染,页面 `document.hidden` 恒粘、rAF 永久死、像素停在旧帧(会话/PTY 全程健康;实测 app 激活/set_focus/hide-show 重放/resize 抖动均救不回)。新增两层防线:kernel/rafFallback 原生 rAF 探针 + 看门狗(遮挡粘死自动上报;隐藏粘死由 Rust Focused 钩子戳探针)+ 壳侧 render_health 阶梯(首击 set_focus、二击 webview reload——会话/PTY 跨重载存活,健康上报即重置,60s reload 冷却防风暴);50ms 垫片保留(部分遮挡形态 ~14fps 地板帧率正收益)。详见 docs/architecture/17-render-health.md
- 每日工作日志:后台生成队列 run 态永久卡死修复;运行中任务可终止(取消即收割生成会话)放行后续任务

### 测试

- 双端点竞速矩阵单测补位(M2 7.4 代码半边):DialPolicy 状态机(单败不切/连二败轮换/退避曲线封顶/arm 清态/单端点不轮换/候选收缩取模)+ 桥层 FakeWS 接线(LAN→relay 换端点短等 250ms 拨通)
- proc_run 测试超时天花板 120s 并先断 timed_out(消 CI runner 进程饥荒假红),stdin 用例注释澄清上限语义勿混淆
- 文件视图 lazy 504 竞态护栏单测:假钟指数退避(两拒后成)、成功 memo 单飞、终败 rejection 不缓存重开新链

## [0.2.4] - 2026-09-26

### 新增

- 学堂插件:左栏入口 + 指南 tab + 入门课向导 + 进度持久化;课程供给 omp 起家(82 命令 13 课)、pi 接入(22 内置命令 + /skill: 调用面 5 章)、扩至九家 CLI;33 条命令按 omp 18.3.1 源码逐条纠偏防幻觉;排版 px→rem 随界面字号缩放,指南视觉对齐客户端设计语言
- 会话历史全文检索:工作区作用域增量索引 + mtime 缓存,按用户输入全文检索、命中一键续聊;统一搜索折叠入口落左栏最顶(搜索/文件快开/会话历史三项经命令注册表分发,会话检索绑 ⌘O);命中行带 token 用量估算,解析层下沉 cli-shared 与 TOKENS 同源
- 跨引擎一键接力:最近输入摘要可编辑后向新引擎会话首发,重试复用会话不再堆空壳,撞墙不停摆
- 窗口失焦系统通知与额度撞墙预警:Ask/轮次结束/会话退出三开关 + 阈值,通道 tauri-plugin-notification
- Git worktree 编排:面板工作树常驻区与分支按检出归属三分区,管理弹窗(porcelain 列表/新建/移除/清理悬空),新建统一 wt/ 前缀、移除安全清分支尾巴(未合并保留并说明),创建即进工作区;侧栏同仓工作区归簇分层,worktree 卡缩进带分支徽章/脏净点/悬空态
- 会话异常退出 toast 与一键续聊:PTY 退出码打通,详情事件补发旧消费方零迁移
- checkpoints 批内敏感路径高危红标:治审批疲劳,宁漏勿扰
- 引擎声明 commandUpdate 就地自更新(kernel + welcome),落后态版本列显裸 semver 防箭头截断
- 手机会话屏截图注入:端内压缩走桥 fs_write_temp 落盘,composer 注 @ 路径
- 发送二次确认:发送前弹目标卡(幕布位序/标题/工作区·引擎)+ 内容预览,Enter 确认 / Esc 或点遮罩取消;行为页开关默认开,广播多幕布并列展示;开框键自确认竞态以延一宏任务挂监听 + repeat 闸根修,确认期草稿活读比对不吃新输入,模态闸防旧计划悬空

### 变更

- CI release:同 tag 重跑先清旧 latest.json,防陈旧 darwin 签名致更新验签失败;macOS 代码签名与公证凭据门控注入;同 tag 清资产改 delete-asset 防 draft 404
- academy 左栏入口压成侧栏 caption 同款单行条目,入口折叠并与搜索对齐换位
- 探针 npm 前缀识别拆 probe_prefix 子模块;三语词典补齐 en/ja 若干批(worktree/退出通知/引擎版本提示/额度通知/academy 域等)
- 面板入口迁右缘竖排 rail:顶栏面板 tab 条退役,钉住∪激活外显 + ⋯ 溢出菜单;内置终端/SSH/WSL 入口随迁(终端 ⌥/⌘/Ctrl 点击强制新建),文件面板操作条上移顶栏右区;wsl 入 ⋯ 菜单可勾选、rail 动作并入钉住管理;直角窗口自绘红绿灯尝试经评估回退,恢复原生标题栏与 rail 原序;提示音设置自行为页迁入系统通知页(桌面通知/提示音/额度三卡);图标装饰新增 worktree 键(簇标签与 fork 图标可自定色)

### 修复

- 设置写盘改补丁合并制:陈旧内存域不再整树砸盘,根修连接中继竞态
- omp 18.3 页脚重设计击穿活动 marks 契约,徽标卡空闲不自愈
- readopt 重锚落位 busyHoldMs 覆盖,冻结期重载不再 30s 窗假结算
- checkpoints bash 提取:sed/sd 带值旗标不再误报、词内重定向不再漏记,会话 JSONL 写盘命令按实参入账
- npm 前缀识别逐级跟 symlink,修 pi 经链接遮蔽的更新不同步
- 侧栏归簇 roots 引用钉住与 setState 等值兜底,修渲染循环卡死
- relay panic 钩子禁再 panic 修双重 panic abort,后台 eprintln 全迁 safe_eprintln 断管道路径
- 七处裸剪贴板调用迁移 copyText,收口 WKWebView 拒写面
- session-search 索引循环健壮化:单步 reject 只跳过该会话不再永久停摆,零作业时正确落位;浮层壳统一自靶关闭与 Esc 闸
- lsp stderr 改纯排空,删无消费者发射;首页页脚双栏钉死 1:1,quota 长错误行省略号截断不再撑爆轨道
- worktree 列表路径回贴输入前缀修 symlink 误判,新建分支预检已存在给可行动指引;弹窗增删清后 bump 刷新,右栏工作树区订阅 nonce 同步重拉
- 手机截图压进桥帧预算防撞 3.5MiB 守卫,iOS 文件面板改 runOpenPanelWith 并持活 relay
- 通知失焦闸对齐文案,桶键只对无重置快照生效;审批收件箱 boot 退订随 activate 返回;academy reduced-motion 全树覆盖

## [0.2.3] - 2026-09-25

### 新增

- 手机 App(iOS/Android):原生壳扫码配对与设备管理(Rust 配对底座:设备表/双凭据 gate/命令域裁剪/配对码),手机独立 UI 树(home 工作区 + 引擎磁盘历史分页 / 会话屏 transcript 对话 + VT 实况 / 配对屏),桥发起会话(引擎白名单 SpawnSheet),审批线窄屏只读摘要 + 审批浮标 + 等待边沿本地通知,凭证钥匙串化,LAN/中继双通道竞速与手动切换;桌面三栏与窄屏抽屉拆分,手机树动态分离不进桌面运行时
- 手机 App 内容与视觉:工作区列表照桌面侧栏图样重排(细线图标 + 会话虚线引导线),home 会话行平铺 + 本地/归档分段 + 按引擎子分组分页,git 面板复刻桌面(状态/差异/分支/历史/远端操作),助手正文轻量 markdown,会话对话层通用渲染重皮(工具调用归组折叠 + transcript 轮询增量生长),壳能力桥(Swift notify/钥匙串/软键盘避让/横竖屏切换),会话屏键盘工具条与审批芯片 sheet
- 外网中继二程:443 真 TLS + 双端证书钉住(绕开运营商全端口 WS 深包检测);Cloudflare/自建服务器双 tab,自建一键 SSH 部署(动态证书钉住);桥端口持久化复用,手机凭证跨桌面重启稳定
- web-access 部署历史落盘并点选整表回填(随存 SSH 密码/口令,私钥内容不落盘),外网使用流程文案大白话重写
- 右栏审批收件箱:聚合等待确认会话,直达定位与自由文本应答
- 远程控制徽标迁入顶栏左区改可点按钮深链设置 Web 访问 tab;图标装饰扩至 12 键
- 信任面三定夺收口:shell 四件套退闸,fs/relay 面维持并写明理由;配对门改协议 capability 判定

### 变更

- 发布流水线首带移动安装包:安卓 APK 仓内自签 keystore(免费可装可升级,本地与 CI 同签名)+ iOS 未签名包;三端构建脚本审计(Draft 预建消并发竞态、轮询显式失败、版本随 tag 注入)
- app 与客户端样式/词典分家互斥载入:app 令牌自持亮暗跟系统,桌面不携带手机树

### 修复

- 终端 ⌘C 菜单复制改走 execCommand 优先剪贴板原语,修 WKWebView 写入失败
- 中继与桥安全收口:请求体上限防远程 OOM、spawn 闸拒路径形命令、背压/帧上限/顶替清场、chmod 校验与 invoke 并发帽;桥事件订阅闸防慢链路手机被 pty 广播灌爆,relay 慢链路背压代杀流 + 手机历史扫描逐区串行削峰
- 手机多轮评审收口:配对闭环三高危、重拨风暴全局退避闸、桥写入补锚定(手机发起轮次桌面状态机同步)、实况固定视口 VT 模型、transcript pi 系 toolResult 误判、reset 零特异性修顶栏压进灵动岛、活会话行借磁盘真标题并对同会话磁盘行去重等
- 死代码清理:移动断点死原语、tauri 死树退役、无消费者的 loadTranscript/onLspStderr 删除

## [0.2.2] - 2026-09-20

### 修复

- composer 发送链路收口:写入失败(会话死/PTY 断)保留草稿并回滚标记乐观翻转,广播汇总「N 路中 M 路失败」,抽屉命令不再假报已发送;草稿按工作区持久化,重启不丢
- 原子写簇:编辑器保存与全部 CLI 配置写回、checkpoints 账本/状态/回退写改原子替换(临时文件带 pid 防撞、保留权限、失败清残),崩溃不再截断用户文件;PTY 退出补子进程收尸并先注册后起泵,根治僵尸累积与秒退句柄滞留
- 搜索完整性:文件快开与侧栏搜索消费截断标志(cap/时间预算两臂),「结果可能不完整」提示补齐索引闸;目录不可读显式「搜索失败」不再伪装空结果
- git 打磨:「全文查看」只构目标文件 diff(保 rename 配对);快速拉取/推送/获取按回执区分「已是最新」;超时放宽 600s 且不再误归因网络;冲突与凭据错误统一中文处置引导;unborn 分支禁点拉推;拉取明细剔除既有暂存;fetch 计入 tags 变化
- 可见失败四修:设置写盘失败出 toast(重启丢改动提前可见);dsh 停止链容错不再卡「正在停止」;终端复制失败保菜单提示;引擎卡版本查询失败行内可见
- 会话生命十项:慢启动崩溃(窗外带崩溃特征)降级「会话异常退出」通知;删除墓碑与归档同步 2000 容量;会话退出后继指针走 MRU;ask 等待摘除对称防抖(瞬时空屏帧不闪摘);Enter 兜底 IME keyCode 229;标记面板失存文件巡检标失联;codex rollout 定位取最新
- 触发符守卫:URL(https://)与双斜杠路径不再误弹命令下拉劫持 Enter

### 变更

- 提示音新增音量档(Ask 与结束提示音共用);终端搜索命中标尺高亮(关闭即清)与输入法组合态防抖;更新检查对 rc 装机剥预发布后缀比较
- 三语词典补齐 en/ja 缺口约 330 键(字面量普查 ~250 + 动态键审计 ~80:插件注册表/引擎配置表单/omp 配置说明整段键,新增 cli2 词典档);cli-omp 配置说明改整段查键,废弃片段级拆分反模式

## [0.2.1] - 2026-09-20

### 新增

- 打开方式插件:复刻 mossx——基础设置配置面板管理目标应用,文件视图底部入口菜单唤起;菜单 is-active 勾选、分割线行列表与居中对话框,深浅主题适配走全局令牌
- 侧栏文件浏览器:工作区行「查看文件」在左栏切出文件浏览器,复用目录树与 git 装饰(状态字母/目录聚合圆点),支持搜索过滤、变更剪枝与忽略降显
- md 预览目录对齐 yn 视觉,补回到顶部浮钮与标记避让
- 更新感应后台化:启动检查转后台,底栏版本号旁提示有新版

### 变更

- 文件 tab 最大化改为仅扩展中央区域,不再折叠左栏或压缩右栏

### 修复

- 批次评审收口 16 项:macOS open --args 参数序(文件参数须置于 --args 前)、并发下临时文件名加序号防串号、嵌套仓变更剪枝只抬一层、PDF/文档大纲层全局 CSS 误伤共享组件、releases.atom 首条为 rc tag 时逐条找稳定版(修 rc 期更新检查误报格式异常)等

## [0.2.0] - 2026-09-19

### 新增

- LSP 语义跳转与引用:cmd/ctrl+点击跳定义与引用侧边预览、F12/⇧F12、右键菜单与悬停提示;TS/JS/Python/Java 四语言 server 发现链;二轮增 cmd+hover 链接态、peek 键盘导航与符号区间高亮、悬停卡 markdown 渲染;语法高亮收敛入 kernel,抽 lsp 组帧模块达标文件规模铁则(契约见 docs/superpowers/specs/2026-09-19-lsp-semantic-navigation-design.md)
- 会话卫生清扫:超期(默认 24h)会话自动归档 + 空会话物理删除,挂磁盘扫描结算点零轮询;行为页开关与时窗(12/24/48/168h);手动取消归档经 kernel sessionKeep 覆盖层护送,远程分支只归档不删盘;恢复对话即解除归档,续命链生效;9 引擎接 isDiskSessionEmpty 钩子,判空收敛为标记子串(读头缓存已存全量头,真解析零增益)
- 文件标记插件:行间锚点跨文件聚合,标记中心面板与 md 预览落锚;发送链路改芯片条 staging——staged 芯片挂 composer.attachments 挂点,真实发送时注入并翻已送达,原「引用块直接写输入框」方案废弃(桥删除,干净切换);md 预览交互卡与面板批量发送;终端回链定位经 kernel 文件深链,评审收口修持久化复活、staged 吞并与注册面旁路,批注卡继承字体并重置 pre 空白修排版错乱
- 全文搜索面板与文件快开:⇧⌘F 全文、⌘P 文件名;Rust `fs_search` 原语(字面匹配即时扫描,与 `fs_walk` 同源语义;3MB 闸 / 8KB 二进制嗅探 / 3s 预算,无持久索引),命中打开文件并定位行;快开带路径模糊匹配与 50 条截断提示(契约见 docs/superpowers/specs/2026-09-18-yn-replicate-md-render-code-search-design.md)
- kernel 编辑器扩展与终端链接宿主注册表:扩展挂点接入文件视图,终端链接注册表接入幕布;编辑器语言扩至 25 家并补行内查找与定位行面;markdown 预览接入 markdown-it 快路径(常规块单遍 HTML 直渲染 + 事件委托,富块留 react-markdown)
- Git 远端操作执行明细:fetch/pull/push 期间工具条横幅提示执行中,完成后通知带回执(提交数、变更文件与增删行数、refs 变化;未 born 分支拉取回退显示 refs 计数)

### 变更

- Git 顶栏嵌入段下移为面板内工具条,删除无主 toolbar 契约;工具条三类型化下拉,视图钮常显文案,左缘对齐内容列;排布两度收口:聚合数字先贴右缘再去箭头,终态聚合数字居左、下拉钮居右;en/ja 词典补工具条文案
- 会话状态巡航接尾读尺寸闸,`configHomeDir` 进程 memo,免每拍列目录全读;cli-codex 状态巡航拆出 `sessionStatus` 模块,闸签名收编 resolver 型并补 30s 重定位周期;会话扫描读头按 mtime 增量缓存,重扫免全库读头;composer 唤醒图标行移至对话框左下横排,锚点栏恢复贴顶紧凑排列;平铺门控与 tab 数量解耦,根治跨 2 边界关开 tab 集体重放遮罩
- 补齐 kernel 与插件纯逻辑单元测试网(88 文件 936 用例),防 AI 改动回归

### 修复

- checkpoints 审批线:open 批首击展示重定基至 HEAD 对齐 git 面板(回退语义仍走账本快照);写入事件记账补身份回填,绑定迟到链不再因 resume 成孤儿;时间线轮询加 10s 悬挂守护,单次 IPC 悬挂不再全会话永久卡死(契约测试锚定)
- 整体评审收口近 20 笔:fs_walk_files 注册回补(曾静默断 @ 补全与快开)、文件深链上移 `kernel/fileTabs` 统一入口根治 Windows 双分隔符双 tab、codex 状态闸补 30s 重定位自愈、终端链接 CJK 宽字符列映射、marks i18n 全族落位
- md 预览拆除整篇合并渲染,marks 落锚恢复子段落粒度;编辑器工具条错误与脏态着色并存不再吞 is-dirty;文件面板底栏操作图标常显;文件 tab 关闭相邻补位,快照不再携带悬空 activeId
- 引擎配置写回改 jsonc-parser 逐叶编辑保用户注释,属性删除走语法树区间手术不再吞相邻注释;sidekick 开关关闭即删块落盘;模型目录失败不进缓存可即时重试;会话与快捷键清洗补数组守卫;引擎配置保存失败显错
- 杂修收口:relay 窗口上限 2 改 3(5h/7 天/月窗齐显)、cli-grok config.toml 缺失与读取失败显式文案、lsp uriToPath 仅对 file:// 解码百分号、技能目录调用名回归目录名

## [0.1.9] - 2026-09-18

### 新增

- 会话看板插件:热力月历 + 泳道时间线呈现全工作区会话,生命周期五态(待运行/运行中/结束-未查看/结束-已查看/已归档)贯通磁盘扫描与活会话合并;归档会话恢复对话即解除归档,生命周期链重启(绑定即续命)
- Web 访问桥:LAN 内浏览器访问本机会话(M1);外网中继出站拨 Cloudflare Worker,一键部署与离线导出包,外网 tab 风险门(M2);部署卡内嵌 Cloudflare API Token 申请引导
- omp 引擎卡版本回退菜单:最新 10 个稳定版 + 收藏,command 通道钉版降级
- Git 分支视图新增名称子串搜索框,本地/远程两组同滤;创建行与操作横幅提为共享组件
- Git 双栏 diff 改中缝连接带排布:行号槽居中缝两侧、改动行色带贯通成横带(GitHub 风四列演进);词级标注预计算提为 useWordParts 两态共用,wrap 态不再逐渲染重跑 DP
- Git 双栏 diff 全文态折叠焦点:连续 context 段收为胶囊、点击就地展开,长文评审免逐屏滚动;同文 zip 对不入折叠段,切文件重挂复位

### 变更

- CI 工作流 checkout/setup-node/pnpm/upload-artifact 升 Node 24 大版本,消 Actions Node 20 弃用告警
- 会话看板泳道收敛三道:待运行并入运行中,结束-已查看并入已归档;左下角齿轮菜单的看板入口移除
- 工作区视图去掉「默认」档,缺省显示本地

### 修复

- 长轮次假空闲根治:readopt 重锚补尾帧 busyMarks 现势证据双通道,扫磁盘日志尾 echoMarks 重锚在途轮次并守结算调度间隙,重载/回显滚出窗后翻空闲不再不自愈;空闲屏整屏重绘不再把已完工轮次复燃为运行时(idleMarks 空闲自证闸)
- win 幕布不再回写 pi-tui 错位 CPR 应答,omp 输入框孤立「C」根治
- checkpoints 审批线收 Windows 绝对路径写入事件,假结算后迟到事件修订重封自愈
- 身份账本跨 webview 重载持久化并在 readopt 定稿后剪除死项;六家 CLI 磁盘会话补 createdAt(修跳日归档),一次读头双解析省一次 IPC
- 会话看板评审收口:瞬态窗挂到期重算、归档层容量提至 2000、打开失败回滚归档、热力归一只算当月格
- Web 访问评审收口:relay 起桥回填 webAccessEnabled 防设置写盘杀桥、relay 启动与 WebBridge 连接竞态、停机订阅预检堵死 else 竞态、/file 改首段 dot 允许制、LAN 绑定收至 lan_ip、跨面设置广播、部署不再自动置 webRelayOn、导出包改系统 Save dialog 并补 dialog:allow-save 权限、外网 tab 三步流程引导
- Git 双栏评审收口:分支过滤 memo 隔离无关状态重渲染、行号槽 +2ch 真余量、nowrap 三面行高同源消 WebKit 亚像素累积错位
- shell 编辑区最大化改样式折叠幕布,会话现场零回放;最大化折叠补夺焦与零宽守卫,侧栏宽度变量不落零
- cli-omp 写入事件解析跟进 details.path 新契约,根治审批线整轮丢账
- 完工换装空闲自证升级为结算证据,短轮次徽标 2s 收口

## [0.1.8] - 2026-09-15

### 新增

- Git 双栏 diff 视图:复刻 IDEA 并排形态——中央行号槽(贝塞尔弧线引导 + 缺侧占位色块/空槽)、红绿同行成对、词级差异下划线、改动块 accent 边框与首尾横线贯通中央槽;撤 react-diff-view 改自绘,左右独立横向滚动条,头部自动换行开关(落盘持久)
- Git 创建 PR 工作流:复刻 gh 预检 → 推送 → 建 PR → 审批评论四步链,PR 内容零本地范围限制;失败透传 gh 原始错误,同仓 PR head 归一化为纯分支名修复已有 PR 复用失效
- Git 历史列表增强:提交行加作者头像与时间元信息行,窗口化渲染只画视口行解大仓滚动卡顿;历史展开按 sha 落槽,修连开提交时全局 token 丢响应永远转圈
- Git 分支着色标注:按分支名稳定着色,顶栏当前分支 label 跟随多仓面板选中仓
- 文件面板工作区下拉化:文件树工作区名改下拉切换,行右键合并文件与 Git 菜单

### 变更

- Git 视图顶栏重排:视图切换下移面板顶行,分支与 upstream 上顶栏,下掉远端操作条;视图下拉回归顶栏 tabs 右侧,刷新/获取/拉取/推送收编进下拉;聚合行动作钮悬停显隐、有变化常显
- 文件面板布局:工具栏移至右栏底部,工作区选择器上移顶栏右区贴面板 tabs,底部动作钮恢复悬停显隐;顶栏分支 label 去底色改纯着色文字
- 顶栏动作/面板 tabs/设置簇图标加大一号,按钮圆角改圆润

### 修复

- v0.1.7 评审收口:git clean 拒 ignored 文件、rebase 中止探测补全、壁纸 GPU 释放与 en/ja 词典、来源注册表补 ctx 通道、变更失败可见反馈、死代码与重复实现清扫
- 二轮复审补口:prewarm 补货收敛为用户动作驱动防崩溃循环,壁纸词典补漏键,check 规则归位,02/09 架构文档同步 ctx 通道
- 双栏 diff 行高去 lh 单位兼容老 WebKit,块底类名归位 block-bg
- PR/双栏 diff 评审收口:推送加当前分支闸、github host 精确匹配、open 态 PR 复用查找、词级 diff 补 u 标志、双栏 DP 去重、双栏偏好贯通详情面板、切仓历史展开领养

## [0.1.7] - 2026-09-14

### 新增

- 工作区壁纸插件:本地图库受管副本 + 表面 token 打穿 + xterm 透底,流体背景 GLSL 五运动场入插件(mode 三态)与缩略图懒加载,通用 fs_copy_file / config_dir 原语入 kernel
- omp 历史会话预热接管秒开:kernel acquireResume / 影子会话原语,注入 /resume 热切换,出生文件锁定窄删,特征熔断降级;注入派发即早激活,切换不再压在整段 resume 渲染之后(契约见 docs/architecture/10-omp-prewarm-resume.md)
- Git 差异面板批量操作:三区拖选扩散多选(与会话管理模式同款交互),批量条按选中集分流暂存/放弃/删除,未跟踪文件可整批删除(git clean),破坏性动作前置确认

### 变更

- WSL 主机面板改版:面板迁至中央 tab 并入设置菜单入口,连接成功自动展开引擎探针,顶部改 SSH 进入并上提引擎/目录选值;主机表单 2x2 等权,探针双列带 CLI 品牌图标,状态色分明(未检出红/可用绿/运行中绿),浅色对比度修正

### 修复

- 长轮次假结算根治:ticker 帧流持轮替换 tick 证据钟,busyMarks 自证钟持轮治混片形态 ticker 永不登记,纯 busy 第二轮开轮同推活动钟修取舍缝
- 壁纸透视根治:elevated 拆 bg-panel 单独打穿保浮层实底,设置面板改壁纸提层透纯壁纸实时跟手,壁纸态幕布与 composer 不透底补齐(终端 token 写手经主题桥通知活幕布即时重读),插排页透视并入提层方案(壁纸40/titlebar45/插排50/设置100);全局审查收尾——退出冲刷防丢改动、id 黑名单防轮播注入、浮层定位补下限
- 设置拉盘合并:引入盘上基线,取消置顶/归档的删除意图得以落盘;基线推进修正——他实例新增不入基线、存活改动保留旧戳,二次写盘不再误删
- Git 拉取分叉未配置合并策略时自动 rebase 兜底,冲突则中止并报错
- 会话行选中底色纳入扎点列,置顶钮改绝对定位叠行右缘让位区
- 会话树参考线由圆角实线改直角虚线,规避与常见客户端形态撞车
- WSL 孤儿工作区:来源插件拔出后不再伪装本地显示,旧版 UNC 形态纳入孤儿隐藏并补元数据回填;添加工作区弹窗改走 DialogShell 居中并适配双主题,改锚定按钮右侧滑出浮层
- WSL 添加工作区本机分支只收绝对路径,~ 误拼进发行版名致新建会话 WSL_E_DISTRO_NOT_FOUND 根治

## [0.1.6] - 2026-09-12

### 新增

- DSH 会话流式输出:适配器 follow 订阅开启 `assistantStream` opt-in,dsh 0.1.2 host 随轮次推送 `assistant-stream` 活帧(start/chunk/end)——正文与思考逐 delta 到达(投影层新增 assistant-stream 帧投影,轮次引擎 text-delta/reasoning-delta 走既有流式管线),durable assistant/message 沉降按 attempt 去重防双渲染;此前正文为整消息沉降(订阅未开 opt-in,旧注释误判「无流式 chunk 事件」,2026-09-12 真机抓帧纠正,codemoss 同款接法)
- WSL 支持(M1):WSL 卡(本机发行版枚举/设默认 + 经 SSH 连远程宿主,主机簿复用 ssh 配置)、添加工作区弹层发行版 tab(远程落库 `~` 形态 Linux 路径,本机落 UNC)、发行版内引擎探针(登录 shell PATH 含 ~/.local/bin;/mnt/* 互操作不计;未探测时新建会话菜单只留引导不显示不可用 CLI)、新建/恢复 WSL 会话(SSH 包装 `wsl.exe -d`,引擎档案随会话透传,点历史行 = 已知身份绑定:去重聚焦既有/磁盘行隐藏/真标题回填)、远程磁盘历史扫描与模型/思考观测(账号级额度照常回填)、远程文件树与 wslr:// 只读预览(超 512KB 显式降级);侧栏分组身份统一「profileId 或 engine」,引擎会话归 CLI 组
- 会话 tab 平铺显示:打开的 tab 全部并排同屏(≥2 个生效),点分栏即聚焦切换,开关全局持久;平铺态输入框出现「广播」开关,开启后输入喂给平铺全部幕布,关闭回落单发
- 界面缩放便捷组:侧栏左下工具条新增 − / 档位 / +(设置页同款 uiZoom),点档位数字重置 100%
- 首页标题条手动全量刷新:首页数据 SWR 缓存后回首页不再自动重拉,标题条刷新按钮一键强制重探全部引擎与前置依赖、绕过 5 分钟 TTL 与去重重拉最新版与凭据额度,探针进行中图标旋转;键盘提示行随 GitHub 链接靠右成组

### 变更

- 首页数据 SWR 缓存与 welcome 常驻层化:探针/最新版/凭据/token 用量落模块级缓存,回首页即时呈现 + 后台静默重验;welcome 与会话现场改 display 兄弟层互切,切换零回放零遮罩;宿主通知订阅收窄(首页三件套锚定注册集指纹、会话状态行 1Hz 按需重渲),会话切换的重渲染面积大幅收敛
- 插件市场改不透明覆盖层:打开时三栏保持挂载且留在下层,会话现场/文件 tab/分栏尺寸零回放零重排,关掉即回
- 回首页按钮改固定身份纯 toggle:永远显示「回到首页」,点一下开首页、再点切回打开首页之前的会话(该会话已退出则保持首页,不再回落其它 tab);市场覆盖层盖住首页时回首页先收市场,「点了没反应」根治
- 内核来源注册表化:workspaceOrigins / fileSources / ptyAdapters 三注册表承载来源插件(WSL)的全部贡献(侧栏过滤/徽章/新建会话适配、远程文件源、spawn 包装),workspace/files 去 WSL 硬编码;拔出插件重启即回内建形态(契约见 docs/architecture/09-wsl-contract.md)
- 会话状态 label 更名:「会话结束-未查看/已查看」→「空闲-未查看/空闲」——原词被误读为进程退出,实义是本轮对话结束、CLI 仍存活;状态机零改动(omp 18.1.17 整轮字节流回放实证诊断)
- 活动守望重构为证据分级模型:输出分片按「字母骨架 + 数字串」分为内容/活家具/死家具三级,静默判定只认内容与活家具(elapsed 计数)证据;新增无 spinner CLI 的 120s 思考期宽限 —— 根治六层特判闸互咬的历史(同日三修:空闲重绘闸 → P0 假结算 → 思考期守卫),真实 omp 18.1.17 整轮字节流回放验收,既有契约测试零改动全绿
- 内部治理:插件边界收敛与 99 处死导出清理(零逻辑改动)、远程磁盘标题索引合并单遍遍历、react-doctor 维持 100 分

### 修复

- 活动守望守卫死锁:回显窗内完结的轮次(/help、即时报错)遇 spinner 永续自绘会永挂运行时,守卫塌缩为单一「未应答写入天花板」(120s 内不结算未应答轮次,到期必结算),连带修掉单帧家具废掉空轮宽限的盲区;重绘抑制窗前置到分类之前(独立评审 F1/F4/F5)
- 悬停提示目标卸载或窗口失焦后清除残留气泡
- 后台会话等待确认经 headless 屏幕镜像补盲,webview 重载后读磁盘尾补底,关 tab 的会话不再收不到提问提示
- 设置持久化前拉盘合并记录层,双实例运行不再覆盖写丢归档置顶等标记

## [0.1.5] - 2026-09-11

### 新增

- 首页终端窗体重设计:无会话首页整页重构为终端窗体形态——prompt 行(工作区选择 + engines/updates 统计)+ 引擎全动作行(新会话/安装|更新|重装/重探/官方文档全动作内联)+ RESUME/QUOTA 页脚;键盘 ↑↓ 移游标、⏎ 直启新会话(原型 docs/design/home-redesign-s-full-actions.html)
- 首页 token 用量 dashboard:RESUME/QUOTA 之下新增「tokens — 用量」区,左列按引擎用量条(量值标柱尖)、右列近 7 日双段趋势柱(输出/输入+缓存),顶部统计条(今日/7 日/消耗会话/pi 系费用);数据纯本地,自各 CLI 会话 JSONL 提取(omp/pi 短名 + claude `_tokens` 后缀 + codex token_count 末次快照),零消耗引擎不显示
- composer 输入历史:Tab 接受 ghost 补全、空输入 ↑↓ 召回翻页、设置页管理区(可开关);IME 组词期补全自动禁用
- 设置:`pnpm doctor` 脚本接入 react-doctor 代码体检

### 修复

- installer 双副本遮蔽:npm install -g 命中的副本不在探针所见路径时(--prefix 遮蔽,hermes/nvm/官方安装器场景),按 node 全局布局加 --prefix 就地更新,「更新成功但版本不变」根治(本机 kimi/opencode 实证)
- dsh 适配 0.1.2+ 协议换代,打通凭据链与会话对话
- git 无 upstream 分支 ahead 降级统计唯一提交数,推送按钮恢复数字与计数标题
- 本机插件插排计数改为已装本地插件数,与页尾本地分区同源
- 插件强化:manifest 权限门面、贡献回滚栈与崩溃熔断;信任闸读回哈希闭环与激活失败状态机修正
- composer 输入历史自评审:ghost 长文本对齐与下拉并存两处 P2

### 变更

- react-doctor 全库治理 45→100 分:a11y(真实 button/listbox-option 语义)、组件复杂度拆件(composer 键盘分发/浮层、welcome 引擎行拆件)、300 行铁则回规;CI 接入 react-doctor 工作流
- pnpm 供应链硬化:新依赖须满 7 天观察期并禁非常规来源

## [0.1.4] - 2026-09-10

### 新增

- 本地插件系统:`~/.tmd-cli/plugins/` 目录放包即装,免重启装载,改盘自动重扫「对话即变」;SHA-256 内容信任闸(未信任先「待启用」确认)与 API 纪元闸双重门禁;设置页「本地插件」分区提供复制开发提示词 / 重新扫描 / 禁用全部,每个插件带权限清单、版本历史与一键回退;插排页本机插件独立成排,composer 抽屉与命令面板同步准入
- checkpoints 归因:工作区外文件写入事件入账,首轮无前像时禁用回退,防误删既有文件

### 修复

- 终端弃用 WebGL 渲染器改走 xterm 内建 DOM 渲染,根治 WKWebView 下 atlas 长跑静默损坏
- 终端启动相位输入闸挡掉 xterm 应答尾字节注入 PTY
- ask 等待提醒只按真作答上抑制闸,synthetic 回传不再清等待态
- 本地插件回退后 manifest 版本号对齐归档快照,版本历史按内容 hash 去重,不再显示「0.2.0-<0.1.0hash>」类错位条目

## [0.1.3] - 2026-09-09

### 新增

- 磁盘会话先行回放:点击磁盘历史即用上一代日志尾分块回放秒出画面(百毫秒级,零进程),resume 进程后台异步拉起;墓碑帧保持可见,CLI 首帧画完(清屏序列后 300ms)无缝切换,全程无白屏;首开无指针会话保持「正在连接」进度遮罩同样无缝切换;新增 `session_link_log` / `session_disk_tail` 原生命令与每 CLI 会话日志指针(纯通用原语,零引擎适配)
- 设置页新增 CLI 独立配置:四引擎本地配置图形化编辑,行级补丁写回零 Rust 改动;omp 配置项全量新手说明(解决什么/影响什么两段式),模型回退链改有序多候选两级选择器
- 快捷键录制改键,命令按钮带键位悬浮提示
- 工作区分组:侧栏分组渲染、设置页组管理、右键移动到组;工作区支持行内重命名别名,显示名全位覆盖
- 审批线面板新增会话时间线页签
- Git 文件 diff 单栏/双栏切换与全文查看
- 图标装饰设置:7 个界面图标独立颜色与呼吸闪烁
- 会话标题 tab 条容量可配置(1-10),关闭时隐藏容量滑杆
- 智能体与提示词资产库:composer「!!」/「##」双触发候选,设置内双 tab 资产管理
- 会话列表扁平化:分组段头与折叠退役,会话行平铺工作区下,行首供应商图标与树形参考线
- 幕布加载进度条:大缓冲分块回放与冷启流式字节计数,全程真实进度

### 修复

- 会话 tab 保活挂载,切换零重放不再重现 loading 遮罩;幕布遮罩就绪后加锁,实时字节与回放回调不再回弹卡死
- 会话标题以首条用户消息即时保底,AI 命名迟到改退避补扫,tab 标题跟随磁盘真标题
- webview 重载后从磁盘日志尾恢复 Ask 等待状态,关 tab 的后台会话不再收不到提问提示
- composer 触发符前置为词字符时不再误弹候选;ask 作答与轮中控制命令不再起审批线锚点
- 审批线查询改按会话 cwd 取账本,修复选中他工作区会话时谎报非 git 空态
- 退出应用杀全部 PTY 子进程防孤儿常驻;应用内重启改走 request_restart,退出杀 PTY 不再被绕过
- 工作区:管理行键盘可达、嵌套按钮不再截胡按键,已删会话隐出运行区且磁盘行删除先杀绑定活会话,归档定位找不到行时给提示,定位请求改 FIFO 队列,磁盘会话打开失败不再静默
- 资产库:提示词重名拒绝、写盘失败上浮 UI,会话消亡剪除选中表死 id,智能体徽章非 emoji 图标回退 Robot,补 en/ja 词典
- CLI 应答宽限收窄到命中分支,EOF/断连立即收割
- 会话 tab 右键重命名仅磁盘会话可用,活会话不再留死链
- markdown 链接分流补 protocol-relative 与大写 scheme
- 记忆面板日期随界面语言切换
- kimi / codex 市场图标恢复 glyph,图标色对齐主题前景变量
- 关 tab 的已了结 CLI 会话加轮次开启闸,异步噪音不再误标未读

### 重构

- 六处注册表并入 createSubscribable,归档/删除覆盖层并工厂;codex 快照降级与 snapshot 塑形收口 cli-shared;mermaid/image 全屏查看器合一;qoder 双分发版收口 makeQoderPlugin 工厂

### 清理

- 移除 cli 副车诊断落盘临时管线,保留缺失警告
- 删除 ssh_sftp_stat / ssh_sftp_transfer_status / ssh_session_status / git_fetch 四个零调用 IPC 命令整链
- release 构建体积优先:opt-level=z,icon.icns 去 1024px,logo 缩 128px

### 移除

- 启动自动激活:预开真实进程换点击秒开的代价为结构性常驻内存(实测整树 6.7GB/3h);其存在理由已被磁盘先行回放整条拆除,设置项与后台预开链路全部移除,退出清场(`kill_all`)保留

## [0.1.2] - 2026-09-08

### 新增

- 会话管理模式与归档视图:工作区侧栏段头开关 / 拖选多选 / 批量归档删除 / 归档徽记
- 工作区归档容量护栏,避免无界膨胀
- 工作区拖选多选锚点改 key 免重排错选,武装态对齐 danger token
- 工作区标题加文件夹图标,与已置顶段头同基线对齐
- 文件树按 Git 变更着色并可在 subbar 一键开关(subbar 通用 actions 槽接入)
- Git 文件列表布局默认平铺,视图 / 布局切换落盘并重启恢复
- Git 分支视图下拉图标化,刷新下移聚合行,loading 兜底转满一圈,审批线换 SealCheck
- Git 拉取失败提示条支持 X 关闭
- 编辑 tab 条上移顶栏与会话 tab 合并一行,编辑栏去第二排;溢出走马灯滚动,会话 tab 前置引擎 logo
- 顶栏右区竖线对齐栏边界,Windows 控制带改绝对定位 overlay 治窄窗重叠
- 顶栏左区图标首尾对调,移除中区项目面包屑
- omp 安装更新前置 bun 门控,依赖就位前按钮禁用并引导先装 bun
- 网络代理侧栏图标换梯子造型
- cli-dsh PTY 适配器一期:会话内对话 / 审批提问卡 / 底栏 footer(host-RPC 第二客户端)
- Git 多仓支持:workspace 根多仓发现(git_repos_scan)与仓上下文切换(RepoBar / 引导 / 跨仓文件树着色)
- 侧栏运行区:运行中 / 结束未查看会话自动聚集且单区显示
- 浅色主题扩至 19 套,并按各主题官方色相重派生终端 ANSI 16 色
- composer 消息锚点栏改贴顶紧凑排列
- 自定义主题的浅色/深色分组支持折叠
- 引擎品牌色烘焙进 glyph,单色品牌统一随主题取前景色(qoder 深浅主题对比度一并修复)
- 顶栏会话 tab 行内加「置顶扎点」与「定位」两枚 icon:扎点与侧栏同语义置顶到全局/取消;定位一键展开左栏并滚动高亮该会话在侧栏的位置(遵循单一区域原则:全局置顶→已置顶区、运行区候选→运行区、其余→工作区分组)

### 修复

- Windows 终端黑屏根修:ConPTY 启动 DSR 由本侧代答 CPR
- Windows 单测缺 v6 manifest 启动即崩,comctl32 延迟加载并平台化旧断言
- omp 子插件装卸 reject 兜底防永转,安装超时追杀整棵进程树
- omp 会话 slug 映射盘符冒号修身份绑定断链,config 解析容忍 CRLF
- 记忆 home 去 node 依赖与池状态二态判定,迁移窗口接线与面板入口兜底
- Tauri gen/schemas 生成物退出版本控制(构建本地再生成),权限真源在 capabilities/default.json
- 会话删除记 tombstone 全域隐藏且先杀后删;归档满额逐出 / 归档视图独立分页;dsh 走删盘删除通路
- dsh 适配器落盘迁入 ~/.tmd-cli/adapters/dsh:清场删除此前被 fs 白名单拒绝恒无效果
- proc_run 收割改杀整棵进程树:Windows .cmd shim 超时后孙进程握管道致线程挂起泄漏
- sqlite_query / sqlite_execute / fs_edit 命令族改 async + spawn_blocking:CLI 持写锁时不再冻 UI
- git shell-out 固定 LC_ALL=C:非英文 locale 下凭据失败不再误分类
- cli RPC 副车应答尾部被提前收割斩断,致命令发现回退静态表

### 重构

- 图标库 lucide-react 全仓迁移 @phosphor-icons/react,依赖与锁文件同步退场
- 清理设计冗余
- 覆盖层满额逐出 / FilePatch 提取 / with_repo 缓存段 / 行标题兜底链 / 终端呼吸灯等六处重复收敛


## [0.1.1] - 2026-09-06


### 新增

- 底栏版本号可点击:弹窗分页查看各版本更新记录,一键检查 GitHub 最新发布并前往下载
- 内置终端:头部左区一键新建本地默认 shell 会话,与 CLI 会话同一套终端体验
- 全局快捷键:设置新增「快捷键」清单,Ctrl+Tab 切换会话标签、⌘J 聚焦输入区、⌃⌘F 终端最大化等
- opencode CLI 引擎接入(第 9 个引擎)
- 记忆协调(Memory)插件:接入 Magic Context 共享记忆库,右栏 Memory 面板 + 状态栏 Memory 胶囊 + Memory 控制台(预蒸馏 / 记忆 / 设置),二期自动蒸馏为 opt-in
- Git:分支右键菜单全量(变基 / 合并 / 对比 / 重命名 / 检出远端分支),推送、拉取、获取改为对话框并带聚合统计,stash 智能还原,推送自动建立跟踪
- Git 差异视图:hunk 头渲染为细分隔条降噪,文件列表终端风显示每文件增删行数,文件行悬停一键打开文件
- 会话标签右键菜单:重命名、关闭其他 / 全部
- Checkpoints 批回退 / 应用改精准手术:只动本批改动块,共改文件不再误伤其他内容
- 会话启动失败弹 toast 明确提示,不再静默无感
- Composer 输入区可拖高至五段

### 修复

- npm 通道安装 CLI 失败(npm 12 默认禁用 postinstall,现自动放行)
- SSH 连接失败保留会话卡,可直接重试,不再原地消失
- Git 视图下拉菜单深色主题下文字不可读
- Git 提交成功缺少反馈,现给出可见提示(与错误同槽位,下次编辑即清)
- macOS 下 Ctrl+M/N/P/W 等按键不再被全局快捷键劫持,按原义传给终端
- 终端输出尾部的不完整字符(如半个汉字)不再丢失

## [0.1.0] - 2026-09-04

首个公开发布版本。

### 新增

- 插件化桌面客户端骨架:Tauri 2 + React 19 + TypeScript,内核注册表 + 插件 ctx 贡献面
- 8 个 CLI 引擎接入:omp / pi / claude / codex / grok / kimi / qoder / qoder-cn
- xterm.js 原生终端画布与 PTY 会话管理,会话标题 tab 切换
- Composer 富输入区:`/` `$` `@` 触发补全、命令抽屉、附件
- 右栏面板:Git 状态 / 历史图 / diff、checkpoints 批次审批、会话预算、网络代理
- 文件编辑器(CodeMirror 6)与多形态预览:markdown / pdf / docx / xlsx
- SSH 一等会话:远程终端 + SFTP 文件树 + 端口转发
- 插件市场、设置面板、网络代理

[0.2.5]: https://github.com/chenxiangning/tmd-cli/releases/tag/v0.2.5
[0.2.4]: https://github.com/chenxiangning/tmd-cli/releases/tag/v0.2.4
[0.2.3]: https://github.com/chenxiangning/tmd-cli/releases/tag/v0.2.3
[0.2.2]: https://github.com/chenxiangning/tmd-cli/releases/tag/v0.2.2
[0.2.1]: https://github.com/chenxiangning/tmd-cli/releases/tag/v0.2.1
[0.2.0]: https://github.com/chenxiangning/tmd-cli/releases/tag/v0.2.0
[0.1.9]: https://github.com/chenxiangning/tmd-cli/releases/tag/v0.1.9
[0.1.8]: https://github.com/chenxiangning/tmd-cli/releases/tag/v0.1.8
[0.1.7]: https://github.com/chenxiangning/tmd-cli/releases/tag/v0.1.7
[0.1.6]: https://github.com/chenxiangning/tmd-cli/releases/tag/v0.1.6
[0.1.5]: https://github.com/chenxiangning/tmd-cli/releases/tag/v0.1.5
[0.1.4]: https://github.com/chenxiangning/tmd-cli/releases/tag/v0.1.4
[0.1.3]: https://github.com/chenxiangning/tmd-cli/releases/tag/v0.1.3
[0.1.2]: https://github.com/chenxiangning/tmd-cli/releases/tag/v0.1.2
[0.1.1]: https://github.com/chenxiangning/tmd-cli/releases/tag/v0.1.1
