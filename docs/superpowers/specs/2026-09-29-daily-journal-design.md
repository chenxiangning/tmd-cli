# 每日工作日志(daily-journal)设计 spec

- 日期:2026-09-29
- 状态:已实现(B1-B5 五批落地;门禁全绿 + 1421 桩目检;真机 tauri:dev 目检留大仙)
- 原型:docs/design/daily-journal-n4-merged.html(年/月/轴三视图 + 每日一篇 AI 汇总文章 + 每日便签 + 节假日 + 后台生成与会话干涉)

## 背景与目标

给 tmd-cli 增加一个「每日工作日志」插件:以日历(年 12 宫 / 月格索引卡 / 轴叙事流)回看每天做了什么;
每天至多一篇 AI 汇总文章(由真实 CLI 会话产出,总览段 + 分节正文 + 未完事项,增量并入留痕);
用户可在任意日(含无会话的空日)手写便签(多行文本 + ⌘V 贴截图),与 AI 文章独立落盘互不覆盖;
生成全部走后台任务队列(切走模块/失焦不中断);生成会话可打开可干涉;节假日联网拉取、断网保底周末底纹。

## 方案取舍

| 决策点 | 选定 | 理由 | 被否决方案 |
|---|---|---|---|
| UI 载体 | 中央 tab(registerTabContent kind "daily-journal"+ 每日文章 tab kind "daily-article"),rail 入口 = registerFilePanel.centerTab(skill-hub 先例) | 原型即 tab 形态;overlay(session-board)无 tab 条承载文章/会话 tab | overlay 覆盖层 |
| 文章存储 | `~/.tmd-cli/daily/article/YYYY-MM-DD.md` 一天一文件,由生成会话(真实 CLI agent)直接写 | agent 写 markdown 天然可靠;增量并入 = agent 编辑自己的 md;解析宽松 | 单一月度 JSON 让 agent 写严格 JSON(易碎);tmd 捕获会话输出解析(协议各家族不一致) |
| 便签/事件存储 | tmd 自有 `~/.tmd-cli/daily/notes/YYYY-MM.json` 与 `~/.tmd-cli/daily/meta.json`(beads/生成状态/任务史/配置);截图落 `~/.tmd-cli/daily/assets/` | 便签与 AI 文章物理分档,重新生成永不覆盖;meta 是 tmd 私有账本 | 便签与文章同档(agent 重写有覆盖风险) |
| 会话强度 | 月格热力按「会话数」四级,不按 token | listSessions 无用量;全月逐会话读转录取 usage 成本高 | token 热力(升级路径:cli-shared sessionUsage) |
| 节假日数据 | 联网拉取中国节假日(NateScarlet/holiday-cn,国务院放假安排含调休;经 ipc.quotaFetch 复用网络代理),成功缓存全年 `~/.tmd-cli/daily/holidays/YYYY.json`(24h 新鲜度窗);失败用缓存;无缓存仅周末底纹;配置关闭时隐藏 pill(已知天花板:节假日名称 zh-only)。timor.tech 实测被 Cloudflare 挑战拦截,弃 | 零 key、含调休;缓存后离线可用 | timor.tech(CF 拦截);nager.date(无中国调休);新开 Rust HTTP 命令(重复造轮子) |
| 完成检测 | 生成会话绑定 host 会话 id;`turnSettled`(输出静默)后重读当日 md,读到即落「完成」bead;`fileEditDetected` 命中文章路径可提前触发重读 | 复用内核既有边沿信号,零轮询 | 定时轮询文件 |
| 定时生成 | app 运行期定时器(默认每日 08:00 生成前一日)+ 启动补跑(昨日缺文章且开着定时) | app 不常驻无法后台跑;补跑覆盖绝大多数场景 | 系统级定时任务(超出 app 边界) |
| 生成设置 | 插件内弹层(原型形态),持久化进 meta.json | 生成配置是插件私有域;不动 kernel settings schema | 注册设置分区(需扩 kernel schema) |

## 契约

### 数据模型

- `DayStatus`(派生,不落盘):`g` 已生成 / `t` 今日增量中 / `p` 待生成 / `f` 失败 / `n` 空(可有便签)。
  派生规则:文章存在 → 今日 `t` else `g`;无文章但有会话 → `p`(今日亦然);meta 记录 lastError 且无文章 → `f`。
- 文章 md 契约(生成 prompt 内固化):`# 标题` 唯一;首段(首个 `##` 前)= 总览;`## 未完事项` 节 = open 列表;
  其余 `##` = 分节,节标题行尾可带 `(HH:MM 并入)` 留痕章;tmd 解析宽松(缺标题/无节均可渲染)。
- meta.json:`{ config, days: { "YYYY-MM-DD": { beads[], sessionId?, engine?, lastError?, updatedAt } }, tasks[] }`
  (任务史截尾 50 条);notes/YYYY-MM.json:`{ "DD": { text, images: [{file,name}], updatedAt } }`。

### 注册面(activate)

- `registerFilePanel({ id:"daily-journal", railGroup, centerTab })` → rail 入口 + 轻量右栏面板(本月概览);
- `registerTabContent({ kind:"daily-journal" | "daily-article" })`;
- `events.on(sessionExited/turnSettled)` 驱动增量与完成检测(模块级 store 常驻,activate 时 boot)。

### 交互(原型即契约)

月格点击 → 文章 tab(空日直接进便签编辑态);轴卡「全文」同;「补齐待生成」批处理;后台任务面板四态
(进行中可打开会话/排队可取消/完成可跳文章/失败可重试);生成会话 = 真实 PTY 会话,「打开会话」= 激活该会话
tab,插话即干涉;今日蓝描边呼吸;便签 ⌘/Ctrl+回车保存、Esc 取消、清空即删、编辑草稿在后台刷新时保留回填。

## 验证(实施结果)

- 全门禁:pnpm typecheck / test 3283 例(域内 24:articleParse/journalStore/daySessions/dateTitle/
  promptGen/taskQueue/holidays)/ check:file-size / check:arch-boundary / react-doctor 100 / pnpm build /
  cargo test + clippy + fmt(fs_write_bytes_base64 原语)。
- 1421 桩目检过:月格 30 格五态热力/年 12 宫点阵下钻/轴卡折叠跳转/便签编辑(⌘⏎·Esc·⌘V 合成粘贴事件
  落盘)/lightbox/生长珠子带/任务面板三分区/设置改引擎存盘回读/快速生成入队 run 态/节假日三视图角标
  (holiday-cn 桩源)。修过的真 bug:空日 sessions.get ?? null 永卡加载;dateTitle 格式器缓存串台;
  live/disk 双计;IME Esc 毁草稿;保存失败静默。
- 数据源实证:timor.tech 被 Cloudflare 挑战拦截(curl 403 页),弃;改 NateScarlet/holiday-cn
  (国务院放假安排含调休,raw.githubusercontent 可达,2026 数据实拉验证)。
- 分批审查(B1-B5 reviewer 五轮)共收 P1×5/P2×15,全部修复:关键者——dateTitle 格式器缓存串台、
  live/disk 双计、IME Esc 毁草稿、调度在配置加载前武装(错误引擎/双生成)、turnSettled 假结算防御
  (文章未现不终态 + fileEditDetected 8s 延迟结算 + 20min 兜底)、定时族失败/取消落「尝试过」珠防重入队、
  生成会话后台拉起(kernel createSession 增 activate 选项 + setActiveSession 聚焦)。
- 真机 tauri:dev 目检留大仙(实施过程不提交,统一收口时提交)。

## 修订 2026-09-30:内容提取层(会话摘录)重构

- 日期:2026-09-30
- 状态:已实现(门禁全绿;真机目检留大仙)

### 背景与目标

首版生成只给 agent 一份标题清单,靠其自行只读探测 7 家 CLI 原始 jsonl 成文;格式异构 + 降级条款
导致普遍放弃,文章沦为标题复述(实测 9 月 1 日 24 会话成文无片段、无过程)。目标:文章须有
事实密度——解决了什么问题、解决过程、原文片段、踩坑与规避。

### 方案取舍

| 取舍 | 结论 | 理由 | 被否方案 |
|---|---|---|---|
| 内容提取位置 | tmd 侧经各 CLI 插件声明的 `readSessionTranscript` 适配器预提取,压缩成当日摘录文件 `daily/digest/YYYY-MM-DD.md`,生成会话以摘录为事实来源 | 行型知识留在各家族插件(内核/跨插件不碰私有格式的铁律不破);agent 读一份干净的 md 即可成文,短链快且质量稳定 | agent 直接读原始 jsonl(7 家格式异构,首版已证不可靠);tmd 解析 jsonl 直灌 prompt(违反适配器铁则,且 prompt 过大会撞 TUI 粘贴限制) |

### 摘录压缩纪律(sessionDigest.ts)

- reasoning/system 块丢弃;user/assistant 空白折叠压单行,保头截断(800/600 字符);
- tool 压单行(160 字符),失败态升格「报错」行并附 detail(词表取适配器实产:`error`/`failed`;
  claude 系 `is_error` 尚未在适配器层标注,属 cli-shared 已知缺口,后续单独收敛);
- 会话级 4000 字符预算,截断时保底追加真末条助手结论(全量预扫定位,不依赖预算内循环到达);
- 全日 100k 字符预算,超出加省略注记;单会话读取失败跳过不拖垮整日,零摘录走清单降级;
- 自指防混入:首条用户消息含生成任务标记(`GEN_TASK_MARK`)的会话即历次生成会话,双层剔除
  (清单行按标题/磁盘标题,摘录按转录首块),杜绝文章给自己写「写文章」。

### 生成契约变化(promptGen.ts)

- 分节正文四点式:解决了什么问题(文件/接口/命令级事实)/ 解决过程(定位-试错-收敛链)/
  关键片段(> 引用摘录原文,可截断禁改写)/ 踩坑与规避(每坑跟「下次避免:…」批注);
- 会话清单行级标注 `(有摘录)/(无摘录)` 按摘录实际收录(coveredIds)逐行实标(grok 等无转录
  适配器的行如实标「无摘录」),与既有 `(已归纳)/(新增)` 水位标注正交;
- 摘录文件读取失败才有降级条款;结算超时 10 分 → 15 分(摘录读入 + 四点式成文体量更大);
- 增量并入、半角留痕、「只回一行」收口纪律不变。

### 验证

- reviewer 全修(4 P1:末条结论保底失效/报错词表不可达/生成会话自指混入/活盘合并 modifiedAt
  停 spawn 时刻误判已归纳;4 P2:全日预算注记恒假/行级标注失真/降级分支仍硬性要求引用/清单未排序)。
- 全门禁:typecheck / test 3306 例(域内 sessionDigest 7 例 + promptGen 契约 6 例 + genSession
  摘录接线 1 例 + daySessions 活盘合并 1 例)/ check:arch-boundary / check:file-size /
  react-doctor 100 / pnpm build。
- genSession.test 超时钉子随 15 分实值更新(串行队列下超时钉不更新会饿死后续用例,实测暴露)。

### P0 修复 2026-09-30 凌晨(用户报「又终止/卡死」复盘)

实测证据链:任务面板批量「补齐生成」×24(00:25:30 一次点按入队整月缺文日)→ 串行队列前两发完成,
用户被迫逐一取消;已完成任务的生成会话不收割,PTY 日志在 done 后仍持续写入 48 分钟(僵尸 TUI 堆积,
直至应用重启才随进程消亡);无摘录降级 prompt 诱导 agent 扫盘探测原始会话文件(失控搜索循环)。

- 收割:finalize 任一路径(成功/失败/超时/提前退出)统一 `host.removeSession(sessionId)`;
- 限量:「补齐待生成」一次最多入队 3 天(新到旧),且月快照未就绪不入队(防文章索引空窗误伤);
- 禁扫:无摘录降级条款删除「查证原始会话文件」,改为「禁止扫描目录或逐个探测原始会话文件」。
- 验证:fillPendingDays 3 例(就绪闸/限量排序/跳过已有)+ 收割断言 2 例(done/超时路径)。
