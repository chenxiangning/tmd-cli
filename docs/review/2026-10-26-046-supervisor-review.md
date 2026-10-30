# 0.4.6 批次监督复审(专业设计师换视角,2026-10-26)

> 状态:复审+修复双收口(P0×2/P1×16/P2×22 当批修复;P2-18 远程乐观锁与 wslExec 路径转义两项明示缓办,见第八节)。
> 背景与目标:0.4.6 二十项批次(04f46b15^..b5dd9494,22 笔提交,186 文件 +3289/-589)
> 已自评收口(docs/review/2026-10-26-046-20items-batch.md)。本轮换监督视角独立复审:
> 五路并行切片(Rust 核心/Rust 辅助/kernel 终端/错误+i18n+设置/插件+mobile),
> 攻击三问(等待窗漂移/跨域双喂/affordance 撒谎)逐改动过堂,双目标=未解问题+过度设计。
> 架构门禁独立复跑:check:file-size 绿、check:arch-boundary 绿(与自评一致)。

## 一、总裁决

批次主体质量成立:20 项里多数是真问题的对症修(8M 预算、单遍重写、错误统一出口、
i18n 真门禁、react-doctor 五处全部真修无「让工具闭嘴」项)。但收口偏快,留下
**P0×2 / P1×16**,集中在三处:①孤儿收割整条链(设计缺陷,不止打磨);②幕布三连
与 rAF 合帧的时序交互(0.4.5 双喂缺陷类新变种,自评只查了窗尾没查时序);③WSL
写回闭环对中等文件不成立(≥18KB 必败)。过度设计净可删约 **-180 行**,最大两块
是 WebGL 探针+记忆链(守护一个默认关的开关,且探针原理上测不到其声称的动机缺陷)
与 ErrorBanner(全仓零消费)。

## 二、P0(2)

| # | 位置 | 问题 | 修法 |
|---|---|---|---|
| P0-1 | `src-tauri/src/session_runtime.rs:91-124` | **双实例互杀活会话**:台账 `~/.tmd-cli/session-live.json` 全局共享,仓内无单实例锁(Cargo.toml 无 single-instance,已核)。第二实例启动收割「pid 仍活」条目=第一实例的活会话,SIGTERM 直杀;B 侧横幅谎报「上次异常退出残留」 | LiveEntry 加 `owner_pid`(登记时 std::process::id());收割时 `owner_pid≠自己 && owner 仍活` 的条目跳过并保留(改 `save(&[])` 为 `save(&保留集)`)。附带封掉 relay 自启(lib.rs:239)先于收割线程(246)的窄窗 |
| P0-2 | `src/app-shell/DesktopApp.tsx:102-113` | **横幅替换整个应用**:`if (orphanReaped>0) return <横幅/>` 排在 `if(!ready)`/`<AppShell/>` 之前,上次异常退出后重开=整个桌面壳被 24px 条替换,须点 × 才见应用;且后端 2s 兜底轮询,横幅可能在应用渲染完 2 秒后才整体接管 | 改 `{orphanReaped>0 && <横幅/>}` 与 `<AppShell/>` 同帧(fragment 包裹),4 行 |

## 三、P1(16)

### 孤儿收割链(a947f617)

- **pid 复用防线是空头支票** — `session_runtime.rs:77-87`。模块头宣称「Unix 下 ps lstart 比对」,`same_generation` 两个 cfg 桩恒返 `true`,`started_ms` 写而不读;重启后 pid 复用即 SIGTERM 无辜同用户进程,注释与实现不符。修:`ps -o etime=` 反推启动时刻比 `started_ms`±3s,或删桩删字段改注释如实。
- **台账 load-modify-save 竞态丢活条目** — `session_runtime.rs:54-75`。`IO` 锁只罩 `save()`,`note_started`(spawn_blocking 并发)/`note_ended`(泵线程)都锁外 load,后写覆盖先写,活条目静默丢失=崩溃后恰漏收。修:锁上提到两入口,锁内 load→改→save,~4 行。

### 磁盘搜索(5e6de723)

- **search_log usize 下溢 panic** — `session_log_search.rs:89`。`hay.len()-pat.len()` 无守卫:needle 长于日志(新会话空日志+长查询,⌘F 磁盘兜底即达)时 debug 减法溢出 panic、release 回绕成巨数后切片越界 panic,该输入恒坏。旧循环 `while i+pat.len()<=hay.len()` 是安全的,重写引入。修:前置 `hay.len()<pat.len()` 早退空结果+补测。

### 幕布三连 × rAF 合帧(68be8de6/9755bfe4/bbc8c29d)

- **攒批×pager 重写乱序双喂** — `terminalStream.ts:107-124` × `terminalHistory.ts:109/148/189`。翻页/跳转/回最新三条重写路径 `await ipc.*` → `\x1bc` → 写 `getOutputBuffer()` 快照,全程不冲 pendingLive;outputBuffers 字节到达即入(含攒批中字节)→ 快照与下一帧 rAF 同批字节双份上屏。0.4.5 双喂类新变种(窗尾→时序)。修:pager 构造器注入 flush,inputGate 同型,`\x1bc` 前冲,~+5 行。
- **8M 预算按写入 MRU 保护,可裁正在观看的会话;裁后 earliestByte 不失效→深跳双喂** — `outputBuffers.ts:66/61-78` × `terminalHistory.ts:96-99`。protect=按最后写入 slice,安静被观看会话(无输出=MRU 头)最先裁到 64K,洪水会话恒受保护(观看≠聚焦≠写入三域没钳);已初始化 pager 的陈旧 earliestByte 使深跳窗与裁后缓冲重叠→重复渲染;rebuild 时 24000 行 scrollback 蒸发成 64K。修:protect 改查挂载真相(handle 注册表/sessionSetViewed);jumpToByte 钳制现算缓冲起点不信存量锚,~+8 行。
- **冲刷与冻结快照隔 xterm 异步解析,fast 重开永久缺尾帧** — `TerminalView.tsx:244-248` × `terminalFreeze.ts:148-149`。xterm WriteBuffer 对新数据一律 setTimeout 异步解析(仅用户输入同步),cleanup 里 flush 冲入的字节下一宏任务才进幕布,紧随的快照不含它们而水位已划入投影覆盖→`[投影末端,unloadChars)` 段永久缺失;rAF 合帧把未解析窗从单 chunk 放大到 ≤256K,概率体量双增。修:flush 返回冲刷字符数,settleTerminalFreeze 从 unloadChars/bytePos 扣除,~+6 行。

### WebGL(2df9dcca)

- **降级三重撒谎** — `terminalWebglRenderer.ts:94-97` × `BehaviorTab.tsx:197-202`。degrade() 只写 localStorage+卸 addon,设置恒 true→开关显示「开」而实际 DOM 渲染,无降级提示;「开」按钮 onClick 清记忆+写 true,值不变→`:154` 早返回,**幕布永不重装**,注释宣称「转开允许重试」为假(须先关再开);重启后同形。修:degrade() 直写 `updateSettings({terminalWebglRenderer:false})` 单真源,开关自动如实回落,重开即真重试,整套 localStorage 记忆随之可删(见过度设计)。

### WSL 写回(1b5cd679)

- **远程保存 ≳18KB 必败** — `wsl_remote_write.rs:35-46`。content→b64(1.33×)嵌脚本→整体再 b64(1.33×)≈1.78×,wsl.exe CreateProcessW ~32767 字符/ssh→PowerShell 同限;读侧预算 512KB「读得开、存不进」,500 行源文件即中招,报错是通道错误非人话。修:按 b64 长度预检给明确错误;根治分块写(首块 `>` 余块 `>>`)。
- **写路径复用 15s 诊断超时,撞 WSL 冷启动即「报失败但实际写成功」** — `wsl_remote.rs:25,196`。注释自述冷启动可达十几秒;超时返回错误但远端多半已写完,用户重试/改内容再存引发真覆盖。修:写命令独立超时(≥60s)。
- **远程保存成功不刷新内容缓存** — `useFileDocument.ts:146-151`。本地分支 success 调 `cacheRefreshContent`,远程分支没有;fileCache 32MB LRU 命中直接返回→远程 ⌘S 成功、关 tab 重开显示旧文且当 saved 基线,再存基于旧缓存静默覆盖磁盘新文(远程无乐观锁)。修:补一行对齐本地分支。

### 编辑器乐观锁(dd9e8237)

- **check→write 竞态窗随体积张到秒级** — `fs_edit.rs:73-81`。mtime 比对后 write_atomic(MAX_WRITE_BYTES 200MB,大文件 tmp 写盘秒级),窗内外部写被 rename 整体静默覆盖——「不再静默覆盖 AI 并发写」在此窗仍会。修:期望态附内容长度/前缀摘要双因子,或至少注释声明残余窗。

### Git(e736cbad/a947f617)

- **porcelain 非 ASCII 花屏+stderr 混入** — `useRemoteGitStatus.ts:63-67,35-37`。未带 `-c core.quotepath=false`,中文文件名成 `"src/\346\226\207.md"` 原样上屏;`2>&1||true` 把 warning/远端噪音行变成假脏文件条目。修:加 quotepath=false;entries 过滤加 `/^[ MARCUD?!]{2} /` 形态校验。
- **「No commits yet」解析出分支 "No"** — `useRemoteGitStatus.ts:29-30`。空仓 `## No commits yet on main` 回退 `split(/[\s.]/)[0]`="No",28 行注释声称该形态已处理(注释撒谎)。修:回退前先 match No-commits-yet 与 HEAD (no branch)。
- **stash 丢弃确认窗内索引漂移,无写前复检** — `StashBar.tsx:199-215`。onConfirm 用弹窗打开时捕获的 index 直接 drop,窗内在终端又 drop/pop 低号 stash→索引前移→**删错条目不可恢复**(apply/pop 同模式)。0.4.5「点击闸+写前复检双层」教训的缺位。修:onConfirm 先 `gitStashList` 复检 index+shortSha 相符,不符报「列表已变化」。

### 错误统一出口(b331f538)

- **E_GIT2 剥码失效** — `errText.ts:18,23`。`[A-Z_]+` 不含数字,而 Rust git 域唯一含数字码 `E_GIT2:` 恰是高频路径(libgit2 透传+任务调度失败),133 处收编后此类错误全域带码裸显,「剥码展示」承诺对它恒不生效;splitCls 测例键全无数字假绿。修:字符类改 `[A-Z][A-Z0-9_]*`+补单测。

### 备份(3c209279)

- **备份落盘静默失败仍宣告「原文已备份」** — `memory-coordinator/install/setup.ts:96-103`。`writeText(...bak).catch(()=>{})` 吞错后成功消息无条件带「原文已备份 {path}」;磁盘满/权限拒时唯一保护是假的,之后主文件照写、原文永久丢(:106 回滚失败同形)。修:备份结果落变量,失败退回无备份宣告文案。

## 四、P2(24,记档待批量打磨)

1. `fs_search.rs:169/112`:命中 max_results 恰在 walk 最后文件时 truncated 不置位,UI 谎报完整。
2. `session_log_sweep.rs:140-142`:手动全清(days=0 无 mtime 闸)删活会话日志竞态,翻页静默降级。
3. `session_runtime.rs:140-147`:Windows 批量收割 >2s 时前端兜底归 0,横幅漏报。
4. `session_runtime.rs` 全文件零测试(A 系列 P1 修复时钉纯逻辑测试)。
5. `terminalStream.ts:103,118,289`:cancelAnimationFrame 裸调,node 测试环境(cAF 不存在)潜在 ReferenceError。
6. `terminalWebglRenderer.ts:45-69`:像素探针只测 alpha 有无,测不到动机场景(马赛克有像素);静态屏+civis 可能全透明假阴即全局降级;`:125-139` 隐藏 tab 0 尺装载抛错毒化全局记忆。
7. `TerminalView.tsx:181`:onReady 锚恢复 settle 不冲 pendingLive,与 jump settle 语义不对称,锚可偏一帧。
8. `pluginLifecycle.ts:93-106`:并行波一者抛错即拒,同波未决者继续跑完并落账,undo 只回滚抛错者→僵尸注册;应 allSettled 收尾统一回滚。
9. `outputBuffers.ts:58-60`:注释「截后重开走磁盘全量」不实(实际放 64K 内存尾),契约注释撒谎。
10. `useFileDocument.ts:188`:setError 裸透 String(e),同文件 :155 已走 errTextDisplay,133 处统一出口漏网。
11. `BehaviorTab.tsx:38`:诊断史读取失败回落空数组显示「无渲染异常记录」——排障面板把读取失败伪装成健康。
12. `ja/settings3.ts:8,11`+`ja/misc.ts:184-185`:中文「清理」混入日语(应为 自動削除/クリーンアップ);`en/settings3.ts:13` 行尾悬空「: 」。i18n 门禁只查键覆盖,拦不住语种错。
13. 保留天数默认 7 双定义(`settingsSessionEntries.ts:61` vs `session_log_sweep.rs:113`):Rust 侧注释声明 TS 真源防漂移。
14. `locales.test.ts:66`:插件词典 glob 仅单文件形态,目录形态(cli-omp/mcp-hub 等 8+)不进 pluginDicts,同键异值断言对它们不生效。
15. `i18n.completeness.test.ts:16`:KEY_RE 不匹配反引号静态串与 t 别名 import(当前仓内零实例,备忘封口)。
16. `useFileDocument.ts:88-101,166`:mtime 基线取失败(如文件已删)永久 null→之后保存全部裸写,静默复活已删文件(恰是 E_FS_MTIME 文案声称要拦的);:94 promise 无 catch。
17. `useFileDocument.ts:169-190`:reload 两往返非原子,窗内外部写→基线对上新 mtime 内容是旧的;修:Rust 单命令同回 content+mtime。
18. 远程写回无乐观锁(自认直写),WSL 工作区恰是 AI 并发写最密集处;读协议加 `stat -c %Y` 伴行 mtime 可补。
19. `wsl_remote_write.rs:27-31/60/42-44`:失败只见哨兵码丢 stderr(W_FAIL_dir_not_empty 对 symlink/权限一律误报);create TOCTOU(`set -o noclobber` 一行闭窗);printf 直写非原子(`>.wtmp&&mv` 对称本地)。
20. `web/dispatch_fs.rs:74-77`:web 桥 fs_write_file 恒传 None 绕过乐观锁(当前 mobile 无调用方,补字段或注释声明);`fs_edit_cmds.rs:24-26` fs_mtime 缺 validate_target;NamePrompt 不校验名字(`a/b`/`..` 可拼路径,本地系老问题)。
21. `render_health_events.rs:1-3,33-35/12`:CAP=64 头截丢起病点(诊断最想要恰是早期链);未聚焦窗口 kick 早退零留痕;at_ms 注释「单调墙钟」不实(SystemTime 墙钟)。
22. `useRemoteGitStatus.ts:65,70`:远端未装 git/ssh 不通一律误诊「不是 git 仓库」;`:65` 路径插值进 bash,含 `$(...)` 即远端执行(自配面,低危)。
23. `useLiveStream.ts:116-124`:首载尾页失败无重试(catch→null 直 streaming),弱网第一窗内容静默缺失至下一 gap;`:83,180-187` replay 放弃期 buffered 无上限,长断连+高输出可致 WKWebView 回收(桌面有 8M 预算,mobile 无);:183 重试 setTimeout 未在 cleanup 清理。
24. `setup.ts:95-97`:第二次安装 readText 读到规范化主文件,覆写 .tmd-bak 丢首装前原文;备份存在即不再覆写。另 `en/git.ts:31`+`ja/git.ts:53` 死键×2(消费点已被 e736cbad 删);`useRemoteGitStatus.ts:73`/`GitPanel.tsx:175`/`SearchPanel.tsx:71` 绕开 errTextDisplay×3(b331f538 之后的新代码)。

## 五、过度设计(净 ≈ -180 行)

| 位置 | 判 | 动作 |
|---|---|---|
| `src/kernel/ErrorBanner.tsx:1-41` | yagni:41 行错误横幅原语全仓零消费(定义+import 双零,已核;aria-label 未走 t() 即从未接线),自评「已就位按需扩」=投机预置 | 删;首个消费者出现时随其落地 |
| `terminalWebglRenderer.ts:14-17,45-69,74-123` | shrink:探针+localStorage 记忆 ~85 行,守护一个默认关的 opt-in;探针原理测不到声明的动机缺陷(马赛克有像素),真死上下文 onContextLoss 已覆盖;与 settings 布尔构成双真源(即 P1 三重撒谎的根) | P1 修法(degrade 直写 settings)落地后整套删除 |
| `session_runtime.rs:77-87` | delete:same_generation 双 cfg 恒真桩+started_ms 死字段 ~15 行,「看似有防线」的负资产(注释还宣称防线存在) | 走 P1 实现路线则换成 ~10 行真比对;否则删桩改注释如实 |
| `render_health_events.rs:21-32` | stdlib:Mutex<Option<VecDeque>> 手搓惰性刱,VecDeque::new() 是 const fn | `static EVENTS: Mutex<VecDeque<_>> = Mutex::new(VecDeque::new())`,None 分支全删 |
| `render_health_events.rs:53-73`+`wsl_remote_write.rs:80-89` | delete:两个测试 mod 断言手写字面量与生产 format!/环形逻辑无关联(环形逻辑在测试体内重写一遍,生产改坏照样绿;「W_OK」字面量断言空洞),共 ~27 行 | 删;P1/P2 修复时以真契约测试替代 |
| `pluginLifecycle.ts:107-109` | yagni:performance.measure("plugin-wave:…") 全仓零消费方,逐插件 mark 已够归因 | 删 measure 留 mark |
| `fileSources.ts:37`+`contributions.ts:164-168`+`ipc.ts:859-861`+`pluginPermissions.ts`+`wsl_remote_write.rs:66-76`+`lib.rs:272` | yagni:removeEntry 删除原语四层全栈落地,全仓零 UI 消费(已核:FileTreeRemote 无删除入口),commit 却称「空目录删除」闭环=宣称已交付但用户不可达 | 二选一(裁决点 ②):删全栈 ~30 行,或补删除按钮 |
| `fs_search.rs:89-93,173-176` | shrink:两分支重复借 query,统一 text.contains(needle) | -2 行 |
| `useLiveStream.ts:170,177,189` | shrink:replayTries 三处重复清零 | 保留一处,-2 行 |

其余核过为 Lean:glob_match 手搓优于引依赖;fs_search_tests 187 行全契约级;8M 预算治理(默认 500K×16 即触)、单遍跳扫、ErrorBanner 之外的错误收编、animStores 请求桥、StashBar 本体、乐观锁本体、fs_edit→fs_edit_cmds 拆分(300 行铁则驱动的机械平移)均应留存。

## 六、裁决点(待大仙拍板)

1. **WebGL 探针去留**:底线修法=degrade 直写 settings(治三重撒谎+删记忆);探针链(~85 行)建议一并删——它测不到自己注释声称的动机缺陷,默认关已是足够闸门。保守选项=保留探针但装载前查 term.element 宽度+文档如实声明只覆盖死上下文一味。
2. **removeEntry**:删全栈(下批要用 20 分钟接回)或补删除按钮(闭环成立)。
3. **P0×2+P1×16 修批次**:0.4.6 CHANGELOG 已备未发版,窗口正好;建议 P0+收割链+双喂三连(时序类)优先热修,WSL 三连其次,P2 批量打磨。真机目检待办(自评文末 8 项)与本届 P0-2 横幅修后同场目检。

## 七、验证口径

- 本复架 READ-ONLY:五切片+主会话共实读 22 笔提交全部改动面与 HEAD 状态,未跑构建/测试(并行编译面互挡教训);check:file-size/check:arch-boundary 主会话独立复跑均绿。
- P0×2、E_GIT2、ErrorBanner 零消费、removeEntry 零消费、无单实例锁六项由主会话亲手二次实证(读文件+grep);其余条目行号均经切片实读核对,未见互相矛盾。
- 深双喂三连(C 系 P1)为静态推演+xterm 源码引证(WriteBuffer.ts:117-137),未运行时复现;修复时应以桩配方(§2026-09-08 存档)回放验证。

## 八、修复落地(同日双收口)

裁决执行:①WebGL 探针+localStorage 记忆链全删,degrade 直写 settings 单真源(三重撒谎根治);②removeEntry 四层全栈删(裁决②);③五路并行修复(F1 Rust 会话/F2 Rust 文件/F3 kernel 终端/F4 kernel 设置/F5 插件+mobile)+主会话集成,与复审切片同域对位。

- **P0×2**:owner_pid 台账保留活实例条目(双实例互杀+relay 先于收割窄窗同封);孤儿横幅改与主壳同帧叠放。
- **P1×16**:全修。收割链(pid 复用 etime 同代校验/台账锁上提)、search_log 下溢守卫、双喂三连(RIS 前冲刷/挂载真相保护集+现算钳制/冲刷计数扣减水位)、WebGL 单真源、WSL 三连(6KB 分块原子写+512KB 预检/60s 写超时/远程保存刷缓存)、乐观锁 mtime+len 双因子、porcelain quotepath+形态过滤、No-commits-yet 分支、stash 写前复检、E_GIT2 正则、备份结果如实宣告。
- **P2×22/24**:修 22(P2-1..17,19,20,21,23,24 + 死键×3 + errTextDisplay 绕开×3 + 探针假阴随探针链消亡);**缓办 2**:P2-18 远程写回乐观锁(读协议加 stat 伴行 mtime 属特性面,另轮)、P2-22 的 wslExec 路径插值转义(自配工作区面低危,另轮)。
- **过度设计**:全部落地(ErrorBanner 删/WebGL 链删/same_generation 桩换真实现/Option 舞删/空洞测试换真契约测试/measure 删/removeEntry 全栈删/fs_search shrink/replayTries 收敛);集成期额外清出 footprint×kernel 撞键 12 处(6 键值冲突+7 ja 星期键值漂移,含死键「今日」)——F4 的 locales.test 目录形态门禁补全后暴露的真实覆盖事故,全部对齐/限定键清零。
- **验证**:cargo test 400 绿(新增 14 测)+ clippy -D warnings 0 + fmt ✓;pnpm check:gate 真退出码 0(4663 测,新增 30+);react-doctor 100/100(含 2 处正当豁免注记);300 行铁则全绿(TerminalView/terminalStream/useLiveStream/useFileDocument 贴线压缩)。
- **真机目检待办**(承接自评文末,新增三点):孤儿横幅与主壳同帧(P0-2 修复面)、WebGL 开关降级回落如实、编辑器冲突横幅 ⌘S 裁决;双喂三连的运行时回放验证(桩配方)随目检同场。
