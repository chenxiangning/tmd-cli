# 会话历史检索(工作区作用域,用户消息全文)

> 日期:2026-09-26 · 状态:已落地(真机目检待大仙)
> 上游:能力盘点 `docs/research/client-capability-gap-analysis.md`(P0-3;「4b 会话历史检索」是证据最硬的能力空白)

## 目标

「那个我让它改 X 的会话在哪」——磁盘历史目前只能按时间浏览,不能搜。本变更给当前工作区一个按**用户输入全文**检索历史会话的入口,命中即一键续聊(openDiskSession,与侧栏磁盘行同语义)。

## 范围边界

| 面 | 做 | 不做(去向) |
|---|---|---|
| 索引内容 | 用户消息全文 + 磁盘标题(解析器 = CliProfile.readSessionUserMessages,与对话锚点栏同源,行型知识留在各 cli-*) | 助手正文解析(各家格式差异更大,随二期评估);代码/工具结果 |
| 索引存储 | 内存 + mtime 缓存(路径→mtime→消息),模块级跨开关复用 | FTS5/SQLite 落盘——千级会话的内存子串扫描毫秒级,落盘反增陈旧与清理负担;真到万级再评估 |
| 作用域 | 当前激活工作区 | 跨工作区全局检索(二期加作用域开关) |
| 交互 | 命令 `session-search.open`(抽屉/改键可达)→ 居中浮层,输入即搜,索引后台增量推进(60ms/会话,进度可见) | 侧栏常驻搜索框(动 workspace 插件,先验价值);正则/布尔语法 |
| 点击 | openDiskSession 续聊 | 定位到具体消息在幕布的位置(锚点跳转是活会话能力,冷会话需先 resume) |

## 方案取舍

| 决策 | 选定 | 否决与理由 |
|---|---|---|
| 解析器来源 | CliProfile.readSessionUserMessages 声明面 | 在 cli-shared 重新写一份跨 CLI 解析——行型知识属各 cli-*,双份真相必漂移 |
| 增量节奏 | 调用方 setInterval 驱动 step()(60ms/会话) | 全量并发读——首建时百级会话 × MB 级 I/O 连发,卡 I/O 总线 |
| 缓存键 | 磁盘路径 + mtime(CliDiskSession.modifiedAt 现成) | 内容 hash——为免重读先读内容,自败 |
| 检索算法 | 大小写不敏感子串 + 标题命中优先 + 最近修改次序 | 分词/模糊打分——中文分词引入依赖,子串已覆盖主痛点 |

## 风险

| 风险 | 对策 |
|---|---|
| 首建慢(百会话 × MB 级读) | 增量推进 + 进度条 + 索引未及处诚实提示「索引还没扫到」;mtime 缓存后开关秒开 |
| 活会话未落盘(omp 懒落盘) | listSessions/读文件本就以磁盘为准,活会话走幕布与锚点栏,不在此面强求 |
| 大文件 32MB 窗外消息缺失 | readSessionUserMessages 契约既有边界(锚点栏同款),诚实降级 |

## 验证

- 门禁:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build` + react-doctor 100。
- 单测:`sessionSearch.test.ts`(作业过滤/排序/done 语义/mtime 零重读/标题优先/大小写/空查询)。
- 真机:`pnpm tauri:dev` 打开浮层 → 搜历史关键词 → 点击续聊,由大仙目检。
