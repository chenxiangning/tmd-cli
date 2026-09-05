# opencode CLI 插件接入评审(换角度)

- 日期:2026-09-05
- 对象:`feat(cli-opencode)` 9003a12(实现)+ 64e703a(文档对齐)
- 方法:独立 reviewer 子代理(契约对齐/单库新形态/SQL 健壮性/依赖方向/同级一致性五角度)+ 本人交叉查证 + 真库只读验证。不复述门禁(已全绿)。
- 结论:实现方向与插件化路径正确,但发现 4×P1 + 2×P2 + 5×P3;P1 全修,P2 全修,P3 修 1 记录 4;并按用户拍板新增 `deleteSession` profile 钩子补齐单库 CLI 的删除语义。

## 发现与处置

| # | 级 | 发现 | 处置 |
|---|---|---|---|
| 1 | P1 | `modifiedAt` 映射 `time_created`(db.ts 行解析),违反 CliDiskSession「最近修改」契约:相对时间/RecentSessions 排序错;复活检测(`modifiedAt > 基线`)永不动 → CLI 内 `/resume` 老会话(time_updated 增长、不新建行)绑不上身份,状态/锚点/事件归因全失效。本机 56/56 会话 updated>created | 已修:`num(row[3]) ?? num(row[2])`(time_updated 优先),测试改钉新值 |
| 2 | P1 | 合成路径 `<db>#<id>` 被 workspace 当真实 fs 路径消费:`SessionList` deleteDisk/deleteLive 的 `fsRemovePath(path)`(Rust fs.rs 把 NotFound 当成功)→ 「删除会话」两步确认后静默无效,重扫回来;`PinnedSessions` 用 `fsReadHead(path)` 解析置顶标题,合成路径必失败 | 已修(用户拍板「加删除钩子」):CliProfile 新增可选 `deleteSession`,workspace 声明即走钩子否则照旧 fsRemovePath;Rust 新通用原语 `sqlite_execute`(READ_WRITE + PRAGMA foreign_keys 让库自带 ON DELETE CASCADE 生效 + 3s busy 超时,库不存在 = Err);opencode 声明 `DELETE FROM session WHERE id = ?1`(FK 级联清 message/part,库副本实证);置顶标题改优先 `CliDiskSession.title` |
| 3 | P1 | MCP 抽屉项未声明 token,composer drawerItems 的 mcp 分区 token 兜底是 codex 专有 `` $name `` 语法,opencode 无 `$` 触发符 → 点击向 PTY 注入字面量 `$servername ` | 已修:摘除 `listMcpServers` 声明与 config.ts 的 mcp 解析(qoder/grok 同阵营;不猜接口) |
| 4 | P1 | edits 水位基准错位:SQL 按 `time_created > since` 过筛,返回 ts 取 `state.time.end`;实测 part 行在工具**启动**时创建、完成时更新(end − time_created ∈ +617~1011ms,time_updated == end),同库 127/578 组重叠工具对 —— 轮询落在并行工具执行中时,同批另一工具的 end 推进水位越过本工具 time_created,其写入**永久漏记**。首版修复(end 过筛)又踩第二坑:`json_extract` 结果无列亲和性,INTEGER 与 TEXT 参数跨类型比较恒假 → 静默返回 0 事件(真库全库 5/5 复现) | 已修:`json_extract(data,'$.state.time.end') > CAST(?2 AS INTEGER)`(基准与 ts 同源 + 参数显式 CAST),返回层再守 `ts > sinceTs`;真库水位 0→5、中位水位→3 与解析侧逐条等价;注释钉死两坑 |
| 5 | P2 | 命令优先级反转:`[...项目, ...全局, ...JSON]` + byValue 后者覆盖 → 全局/JSON 压过项目,与注释/opencode 官方语义/config.ts 合并方向相反 | 已修:`[...JSON, ...全局, ...项目]`(项目最高),测试钉死 |
| 6 | P2 | 「自定义覆盖内置」被内核 `mergeSuggestions`(静态优先、动态同值只增不顶替)抵消,插件内合并成死代码;UI 显示与 opencode 实际执行(自定义覆盖内置)分叉 | 已修:动态层只出自定义项,内置交静态表 + 内核合并;同名自定义显示内置描述记录为跨引擎统一语义的已知限制(omp/pi 靠该语义保护调校 action,不为 opencode 破例) |
| 7 | P3 | `detectVendorByProviderId` 不识 opencode 的 `minimax-cn-coding-plan` id(zhipuai-coding-plan 因 omp 同名恰好命中),本机 auth.json 实有该键 → 引擎卡显示原始 id 不查额度 | 已修:detect.ts minimax-cn 组补 `case "minimax-cn-coding-plan"` |
| 8 | P3 | json_extract 坏行毒化整查询(SQLite 直接报错):userMessages 恒 null 锚点栏死、edits 水位停摆。本机库坏行 0(WAL 原子提交 + opencode JSON.stringify),低概率高半径 | 记录:接受现状(edits 侧已有单行 try/catch 容错;SQL 级 json_valid 预筛对 planner 求值序无保证,收益存疑) |
| 9 | P3 | askMarks 缺席:opencode 确认面板字面量未实证,Ask 卡片只剩内核通用 y/n 标记,可能静默漏报 | 记录:移交目检清单(抓面板页脚字面量后回补,方向与 claude/codex/grok/qoder 一致) |
| 10 | P3 | sqliteQuery 是同步 Tauri 命令,本补丁首次挂上 2s/4s/500ms 轮询(messageAnchors/checkpoints/identityWatch);session 表无 directory 索引全表扫 | 记录:本机 10MB 库尚轻;卡顿实证后走 spawn_fs 异步通道或建索引 |
| 11 | P3 | 语义债/待实证:quotaEnvValue 复用读 XDG、configHomeDir 实为 home(omp 同款);`directory = ?1` 无尾斜杠/符号链接归一;Windows 数据目录同公式待实机;子目录 spawn 时 directory 取值无正例(真库无反例) | 记录:spec 已声明待实证;归一问题实证后随修 |

## 新增契约(评审产物,用户拍板)

- `CliProfile.deleteSession?: (cliSessionId) => Promise<void>`:单库多会话 CLI 的「删除会话」钩子;未声明照旧 `fsRemovePath`(kimi/qoder)。SQL 知识在插件侧,内核零 CLI 知识。
- `ipc.sqliteExecute(dbPath, sql, params)`:通用参数化写执行,连接启用 FK 级联 + 3s busy 超时;库不存在 = Err(与读通道「不存在=空集」语义区分)。Rust 侧带 FK 级联删除与缺库报错两用例。

## 验证

- 门禁:pnpm typecheck / test 99 文件 816 例 / arch-boundary / file-size / build + cargo test 174 例 / clippy -D / fmt 全绿
- 真库只读:水位 SQL 两版对照(0→5、中位→3 逐条等价);FK 级联在库副本实证(message/part 归零);`directory != message.path.cwd` 样本均为缺 path 的旧行,无子目录归一反例
- 修正回归:modifiedAt/水位 CAST/优先级/去重/MCP 摘除均有测试钉死;db.test 以 SQL 文本断言锁 CAST 与 end 基准
