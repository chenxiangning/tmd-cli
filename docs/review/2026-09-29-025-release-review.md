# tmd-cli 0.2.5 发布整体评审(终端域专项 + 死代码 + 包体)

- 日期:2026-09-29
- 状态:已完成
- 范围:`git diff v0.2.4..v0.2.5`(95 提交,449 文件,+29719/−2073)整体走查;终端/PTY 域按性能、边界、兼容性三轴精读;任务二为死代码清理(已执行)与安装包体审计(分析结论)。
- 方法:终端域与 kernel 契约层逐行人工审(askWatch v3.2 全链、pty.rs/pty_spawn.rs、proc_run、profileSend/promptGate、web 桥);session-viewer、hub/画布/新 Rust 模块由独立评审代理走查(行号均实读);死代码扫描 = tsc 基线 + 导入图/导出消费/命令注册三扫描器 + 全仓 grep 逐项复核,关键项再人工终验;包体 = gh 资产实测 + 逐文件解包核算 + esbuild 双树闭包实测。

## 结论

整体质量高:预算/坏行/孤儿配对/图片 CSP/分批渲染等关键契约均有真实实现与测试锚定;Rust 侧 zip-slip(条目级)、原子写、超时收尸纪律完备。发现 **1 个 P1(安装链 slug 路径注入,建议 0.2.6 首项)**、终端域 1 个 P2(Ask 徽章单拍缺席即摘)、插件域 8 个 P2;死代码量级很小且已随本轮清理(13 文件 −60/+4,全门禁绿);包体优化空间集中在**分发策略**(分架构、手机壳瘦身、R8)而非代码。

## P1(建议尽快发补丁)

### P1-1 ClawHub 注册表 slug 未净化 → 任意目录写入(zip-slip 防线旁路)

- 位置:`src/plugins/skill-hub/clawhubNormalize.ts:72-73`(slug 仅判非空);`install.ts:101`(`dest = ${target.dir}/${resolved.slug}`);`install.ts:123-125`(skillSymlink 两端同拼);`src-tauri/src/skill_pkg.rs extract_zip`(dest_dir 完全信任,条目名有 `..` 闸但 dest 本身无分量校验)。
- 触发:ClawHub API(或恶意发布者数据)返回 slug 形如 `../../.ssh` → 解压逃出 `~/.claude/skills` 覆写任意用户可写文件(`fs::File::create` 静默覆写)。
- 修法(一行治根):`normalizeClawHubCard` 对 slug 加单段白名单 `/^[A-Za-z0-9][A-Za-z0-9._-]*$/` 且不含 `..`,不合法丢卡(既有「slug 缺失=丢弃」分支承接),补一条恶意 slug 单测;纵深可再加后端 dest 分量拒 `..`。
- **已修(2026-09-29,bd92d1f5)**:`clawhubNormalize.ts` 收口处白名单落地(首字符字母数字,余 `[A-Za-z0-9._-]`;`.`/`..` 被首字符规则一并排除),恶意 slug 单测 9 形态锚定;后端 dest 分量纵深闸未加(收口已覆盖全部三条入口:列表/搜索/详情)。

## P2(排入 0.2.6)—— **2026-09-29 已全数修复**(0f35ee55 / 661cf358 / 7bea31ac / 1cc7e743 四笔按域 + 26ad52e3 回写;自审复查补双通道短路与 quota SSE 收窄两处 = 22e9ce12。门禁全绿:3251 测试 / typecheck / arch / file-size / cargo test+clippy+fmt / doctor 100 / build)

### 终端域

1. **Ask 屏幕态单拍缺席即摘,徽章可闪摘再复燃** —— `src/kernel/askWatchCore.ts:130`:`waitingByScreen` 在一次 `present=false` 采样即删,而字节态摘除有 `absentSince ≥ASK_CONFIRM_MS` 防抖(注释自证「整帧重绘空屏帧」存在)。0.2.5 采样 1Hz→250ms,采样落在清屏帧与重绘帧两 macrotask 之间的概率 ×4;命中 = 徽章闪摘 → ≥1.2s 后复燃。修法:waitingByScreen 同款缺席防抖(注意 askWatchCore.test.ts:134 钉了现行为,改行为需同步改测)。
2. **mcp-hub JSON 家「首存即建」破裂**(代理发现,边界):`hubStore.ts:149-155` 目标父目录不存在(CLI 装过没跑过)时保存必败;修 = missing 分支先幂等 `fsCreateDir` 再写。
3. **mcp-hub StoreView 拉取无竞态守卫**:源切换/搜索词变更旧响应晚到覆盖新列表;同插件 skill-hub 已有 alive 守卫,照抄。
4. **http/sse MCP 连通测试误报**:`quota.rs` `.text()` 读到 EOF 才返回,保持流打开的 streamable-http/SSE 服务器必 15s 超时误判不可达。
5. **AI 作画 inbox 吃半截文件**:2s 轮询撞上 CLI 非原子写入 → 解析失败即留证+trash 原文件,内容永久丢失;修 = mtime 新鲜或连续 N 轮失败才判坏。
6. **画布索引 index.json 无体积闸**:缩略图内联累积约 60-80 张后超 512KB 读闸 → 列表清空且保存中止索引更新,状态随保存恶化;文档级 496KB 闸已有,索引漏配对偶。

### session-viewer 域(代理发现)

7. **dsh 转录解压无预算**:32MB 闸只量压缩尺寸,解出可百余 MB 全在主线程;超限报错被吞成笼统「读取失败」。修 = fzstd 流式按字节预算截尾置 truncated(对齐全族契约)。
8. **grok 同文块重复 React key**:id=内容哈希,用户连发「继续」即撞 key(控制台报错,追加列表行为未定义);kimi/dsh 兜底 id 同族。修 = 渲染层 key 复合序号,或 parse 层 id 追加行序号。
9. **分批渲染缺 memo**:`blocks.slice(0, visible)` 每次新数组引用,react-markdown v10 零内部缓存 → 每次触底追加对全部已挂载块全量重跑 remark/rehype;修 = React.memo 包 TranscriptBlockView 与 PhaseFold。

## P3 摘录

- 终端:SessionSpeedPill rollout 切换后读旧文件冻结至轮终(注释已声明天花板);AskScreenMirror 几何拉取竞态窗口内首帧按默认栅格解释,下一整帧自愈(设计接受)。
- 查看器:>32MB 截断孤儿工具结果块降级「tool+已调用」语义错位;`sessionTranscript.ts:13` 头注「grok 未接入」过期;phaseTitle「工作/思考」未走 t();`isWrapperText` 以 `<` 开头即滤,用户贴 HTML/SVG 提问在查看器静默消失(锚点栏口径合理、查看器保真度受损)。
- hub:InstallDialog.start 双击窗口并发安装同 tmp;skillStore 强刷被在途扫描吞;copy_tree 跟随 symlink 可成环栈溢出;net_download 无字节闸;probeHttp 对 pretty-print JSON 误报;readTriState 递归列 $HOME(单层 fsListDir 即可)。
- i18n bug(本轮已顺手修):intent-canvas 词典键「若当前有未保存的编辑器内容…」全角逗号与消费端半角不匹配 → en/ja 界面该句漏译(死键+漏译同源)。

## 已确认无问题(要点)

- pty.rs kill 锁范围收窄 + kill 失败仍收尸(F-PTY-001/PTY-R1 修复正确);Windows NTSTATUS Ctrl+C 归一 130 单点无遗漏;proc_run stdin 写后关管语义正确(64KB 管道缓冲上限已注释)。
- askProbe 贴底闸/就绪闸/非贴底停采设计正确;镜像-幕布互斥防双源;`Promise.withResolvers` 有 shim 兜底。
- 32MB 预算与 truncated 语义(jsonl 六族)、坏行/UTF-8 截断双闸、空 transcript 空态、图片 CSP(data:)、思考链折叠均有实现+测试。
- profileSend 翻译护栏(`$100`/`$HOME`/URL 不误伤,translate 仅 `$` 系触发符);promptGate 两道闸;promptSent 轮次口径。
- web 桥:`fs_write_temp` 窄豁免 + Windows canonicalize 双侧对齐;skill-hub/mcp-hub 弹窗 busy/locked 纪律齐;intent-canvas 持久化主体(stale 闸/锁/RMW/废纸篓)完备。

## 任务二之一:死代码清理(已执行)

13 文件 −60/+4,门禁全绿(typecheck / 3247 测试 / file-size / arch / cargo check):

| 删除项 | 位置 | 说明 |
|---|---|---|
| `wizardTarget`/`toggleGuideTab` | academyStores.ts | 全仓零引用;import 同步收紧 |
| `allInstalledSkills` | skill-hub/skillStore.ts | 0.2.5 新增插件遗留,订阅路径接管 |
| `IntentCanvasContextSendAttachment` | intent-canvas/semantic.ts | 死类型块 |
| `web_access_start/stop` 命令注册 | web_access.rs + lib.rs | 前端零 invoke,函数保留(内部仍调);缩小 IPC 面 |
| 词典死键 11×2 语言 | cli2/git/skill-hub/intent-canvas locales | 逐键全仓 grep 终验零消费 |

- **扫描器两处误报已人工拦截**:settings/settings2 域 5 条中继引导长文案被判死——实为 web-access 插件以**字符串拼接**消费(WebSelfHostPane.tsx:24/WebCfPane.tsx:24,30),逐行 grep 全文匹配漏检;教训:**长键必须按片段再验一次**。
- 未动:约 100 个「export 关键字多余」符号(纯风格批,非死代码);`_itemsCoverAllKeys` 等编译期穷尽断言(刻意);测试专用访问器。

## 任务二之二:安装包体审计(分析,未改动)

资产现状(v0.2.5 实测):AppImage 88.9MB(WebKit 全家 235MB 未压缩入 squashfs)/ universal.dmg 26.6MB / msi 13.8MB / apk 13.5MB(dist 压缩 5.64 + dex 7.04)/ deb·rpm 13.7MB / iOS zip 7.1MB。dist 全量 17MB(DesktopApp chunk 3.10MB、excalidraw 1.82+1.08(54 语言包)、mermaid ~2.1(已懒加载)、pdf.worker 1.23、katex 双版本并存 2×259KB)。

优化清单(按节省/风险排序):

| # | 措施 | 预估节省 | 风险 |
|---|---|---|---|
| 1 | macOS 分架构 dmg+updater(universal → aarch64/x86_64 双产物) | 下载/更新 26.6→~14MB | 低 |
| 2 | 手机壳装 mobile-only dist(esbuild 实测 mobile 树仅 0.81MB) | APK 13.5→~8MB;iOS 7.1→~2.5MB | 中(需回归手机首启) |
| 3 | APK 开 R8(dex 7.04MB,现 minify=false) | 再减 ~5MB | 低-中 |
| 4 | excalidraw 语言包裁剪(留 zh/en/ja,仿 prune-katex-fonts) | dist −1.0MB | 低 |
| 5 | katex 双版本去重(直依赖 0.18.9 对齐 rehype-katex 传递 0.16.47) | −259KB 全端 | 低 |
| 6 | CliConfigTab 改懒加载 FileCodeEditor(静态拖入 codemirror core) | 首屏 chunk −~200KB | 低 |
| 7 | 图标瘦身(icns 817KB→~300KB;logo.png 276→~90KB) | −~250KB | 零 |
| 8 | AppImage 处置(产品决策:砍掉 / 微裁 / 维持) | −88.9MB / −~1MB / 0 | 中 |
| 9 | Windows 单安装器(setup.exe 与 msi 二选一) | −11.6 或 −13.8MB | 低 |

不建议动:Cargo release profile(lto/cgu=1/strip/opt-level=z 已最优)、prune-katex-fonts、mermaid/xlsx/pdf 懒加载(功能体积)。

## 验证

- 清理后:`pnpm typecheck` ✓;`pnpm test` 410 文件/3247 用例全绿 ✓;`pnpm check:file-size` ✓;`pnpm check:arch-boundary` ✓;`cargo check` ✓。工作区仅含本次清理 13 文件改动。
- 评审本身为只读走查(代理未跑运行时);P1 与终端域 P2-1 经本人实读源码复核确认。
