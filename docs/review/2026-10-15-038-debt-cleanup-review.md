# 0.3.8 技术债清账评审记录(批次一二三 + 验证)

- 日期:2026-10-15
- 状态:已实施,多轮评审收口中(全部改动未提交,待大仙验收)
- 上游:`docs/brainstorm/2026-10-13-037-next-steps.md`(批次二/三/四欠账源头)、任务 `t-mv915j4b-4pd2b2`

## 背景与目标

0.3.8 发版差距盘点(2026-10-15)发现四类债:发版机制账(CHANGELOG/版本源,属发版收口时序件不在本轮)、验收债(真机目检,留大仙)、存量治理欠账(空壳项目/openspec 归档)、anim 插件代码级小刺。本轮按 TDD 分批清偿「能做的」,不能做的见文末清单。

## 方案取舍

| 决策点 | 选定 | 被否决 | 理由 |
|---|---|---|---|
| 修复落点 | 抽纯 DI 管线 `startSession.ts`(prepare/start 两步) | 组件内联继续改 | node 环境无 DOM,交互逻辑要 TDD 必须脱离 react;先例 genSettle/menuNav;组件只剩胶水,300 行铁则余量更大 |
| 行上文件损坏 | 报 `invalid-project` 拒绝开工 | 静默改道建桩 | 建桩会覆写路径上的用户手改内容;损坏是用户需知道的事实,toast 指路修复 |
| 已实现 change 处置 | 原目录 `git mv` 进 archive/ | 改写 proposal 内容再归档 | 惯例 = 目录位置承担归档语义,proposal 保留实现态头部(先例 approval-inbox 等);docs/README 状态列改「已归档」 |
| 空壳项目清理 | 手工一次性删 13 个 + 文件级备份 | 写长效批量归档工具 | 一次性需求不值得立工具;长效治理已在挂账清单(spec 立项) |
| 失败上报 | 管线结构化 reason + 组件 t() 映射 | 管线直接 toast | 管线保持无 i18n 依赖可测;文案集中在组件层一处可换 |

## 批次一:anim 交互刺(TDD)

三条修复,先写失败测试再实现:

1. 引擎缺失静默 return → toast「未设置默认引擎,请先在工作台概览选择」;
2. home 未就绪静默 return → toast「主目录未就绪,请稍后再试」(词典 en/ja 补键);
3. spawn 失败桩残留 → 清理本次落的桩(失败零残留;只清本次的,绝不碰用户已有文件)。

手法:决策/副作用管线抽纯 DI 模块 `startSession.ts`(`prepareAiSessionTarget` / `startAnimAiSession`,先例 genSettle/menuNav),`startSession.test.ts` 11 例单测钉决策与副作用序列(node 环境无 DOM,交互挂载面走桩目检);组件 `animProjectsTab.tsx` 只留胶水与 toast 映射,失败一律结构化上报原因。

## 批次二:openspec 账实对齐

- `2026-09-28-mcp-hub-plugin` / `2026-09-28-skill-hub-plugin`(状态「已实现」)`git mv` 进 `openspec/changes/archive/`,`docs/README.md` 两行引用随迁、状态改「已归档」;
- `2026-09-22-mobile-app-m2-light-interaction`(真机验收余 8 项)/ `2026-09-26-signing-pipeline`(待 secrets/证书)保留在 `changes/`,proposal status 行已写明阻塞项,合规不动。

## 批次三:空壳治理

- 前置实证:客户端未在跑(lsof 1421 无监听、无 tauri 进程),直接改 `~/.tmd-cli/workbench/index.json` 无并发写风险;
- 备份 `index.json.bak-20261015-debt` 后删 13 个零任务零文档零更新空壳项目(Octop / cxn-test / yokohama / ccgui-plugin-wsl / cxn / .ssh / home / agentdeck / codemoss / guanjia / er-qi / Downloads / tmd-cli-spec),16 → 3(保留 tmd-cli / 内容分析 / springboot-demo);
- 预期复核口径:概览「N 个未跟踪项目」行与聚焦页脉搏索引带随真实项目数收敛(需真机开工作台看)。

## 验证

- `startSession.test.ts` 13 例(终态)+ anim 存量 15 例 + tabContent 契约 = 28 测试绿;tsc 净;check:file-size / check:i18n-keys(缺键 0、不对称 0)过;
- **check:gate 全链绿(2026-10-15,改动树上实测)**;**react-doctor 100/100**;
- 1421 桩目检六场景(vite dev + Tauri IPC 桩;前三场景轮 1/2 期间,后三为轮 3 补测):
  - 1a 引擎缺失:点行「AI 会话」→ toast 明确、确认窗不开;
  - A 行项目 + spawn 失败:确认窗 link 卡/协议引用齐、「启动会话」→ toast「启动 AI 会话失败」+ 窗不关(prompt 保留)+ 非桩路径不触发删除;
  - 1c 空态建桩 + spawn 失败:「新建项目桩」徽标在,副作用序列钉死 = fs_create_dir 逐级 → fs_write_file(桩) → session_spawn(拒) → fs_remove_path(只清本桩),窗不关;
  - 1b home 拒绝(config_home_dir reject,预置默认引擎后经空态入口):toast「主目录未就绪,请稍后再试」+ 窗不开;
  - D 行上文件损坏(fs_read_file 回坏 JSON):toast「项目文件无效,请先在 tmd-anim 中修复」+ 窗不开;
  - E 成功 spawn:session_spawn 参数面逐项正确(profileId/command/cwd=项目目录/title=tmd-anim:项目名);桩缺内核 adopt 链命令致装配失败 → toast+窗保留,失败路径语义按设计工作(成功关窗由单测钉住)。
- 评审轮次与处置见下节。

## 挂账清单(本轮不做,需大仙/后续)

| 项 | 为什么不在本轮 |
|---|---|
| CHANGELOG `[0.3.8]` 小节 + 六处版本源 bump(另 re-local Info.plist 未跟踪且停 0.3.6) | 发版收口时序件:须在清账提交落定后、打 tag 前做;本轮约定不提交 |
| 合 main + 打 tag + Release 正文核对 + CI 产物验证 | 同上,发版动作 |
| anim 真窗口 tauri:dev 目检(桩目检已过三场景) | 需真实窗口,本轮桩环境覆盖不了真机 spawn/open-with 链 |
| 0.3.7 批次一 6 项真机目检(看板窄容器/一键关联真实工作区/journal 次日重生成/docgen 阅读链/深链冷启动) | 真机验收债,需真实数据与窗口 |
| M9 失败 pill 真实磁盘错误场景目检 | 桩环境各 CLI 扫描器吞错,不可驱动 |
| 0.3.5 真机验收单 14 项(手机 M2 尾项/外网三件套/安卓四项/双实例 updater) | 大仙扫码件,与 0.3.8 无依赖 |
| signing-pipeline(待 secrets/证书)、mobile m2 真机 8 项 | 外部依赖(证书采购/secrets 配置) |
| anim「打开」非 mac 平台语义(open_with.rs app 目标 = PATH 尽力 spawn,GUI 应用必失败落 toast;probe 同理回落 which) | 已有优雅降级;真修(按平台禁用/引导)属产品拍板,宜 Release 说明「打开动作 macOS 完整可用」 |
| 看板拖拽键盘替代 | 属新功能面,0.3.8 已有 anim 功能增量,不再接料 |
| workbench 空壳治理的长效工具(未跟踪项目批量归档) | 手工 13 个一次性已清;长期需求需 spec 立项 |

## 评审轮次

- **轮 1(外部 reviewer,全量)**:OK with notes,零 P0/P1;两条 P2——①startSession.ts 两个 catch 吞错误对象,诊断链路为零;②parseAnimProject 解析名被丢弃,rows 瞬态失明时误显「未命名动画」。轮 1 同时核实:并发 starting 闸/失败不关窗/只清本次桩/原子写无半截文件/i18n 缺键 0/行数与架构硬约束全过。
- **处置(仍 TDD)**:①两个 catch 补 `console.warn("[anim] 桩落盘失败/spawn 失败", err)`(先例 kernel/cliProfile 诊断口径);②name 回落链改 `stub ? "未命名动画" : rowName ?? parsedName ?? "未命名动画"`,invalid-project 判定随 parsed 判空;新增 2 例测试(行名瞬态缺失回落解析名=红灯先行;清理自身失败仍 resolved start-failed=best-effort 回归锚)。修复后 anim 28 测试绿、tsc 净、file-size/i18n 过。
- **轮 2(外部 reviewer,窄范围 P2 增量复审)**:**OK**。P2-1/P2-2 均判定已修复(处置逐字落实;parseAnimProject 对空串/空白名回 null,`??` 链无空名漏显的洞);两条新测试「非同义反复,删语义即打红」;增量无行为回归。新发现:没有。
- **轮 3(外部 reviewer,终轮全量查漏,六维度)**:**OK with notes**。引用面(旧路径全仓 grep 0 残留)/词典完备(anim en/ja 各 33 键 + 动态三键全有)/行为面(无剩余静默,openInApp 顺带核过)/测试面(无关键缺口,stub refs 断言核实为非缺口)/提交面全过;三发现全处置:P1-1 三处「待归档」陈旧表述(根 README.md:247 / README_EN.md:247 / architecture/01-overview.md:155)改「已归档」;P2-1 本记录补「方案取舍」节(五条对照);P3-1 chip aria-label 插值补 t()(en 读屏混排修复)。另查漏自修两处:mcp-hub/index.tsx 头注释旧路径改归档路径;「目标项目」动态键补 en/ja 词典(此前 chip 端 en/ja 漏出中文)。

## 验证终态(收口时点)

- 轮 3 处置后终树复跑:**check:gate 全链绿(2026-10-15,file-size + arch-boundary + i18n 键 + typecheck + test + build)**;react-doctor 100/100(终树复验);
- anim 域测试 28 绿(startSession 13 + 存量 15)+ mcp-hub 合跑 58 绿;tsc 净;file-size ≤300 行全过;i18n 缺键 0、不对称 0(词典 3469 键);
- 1421 桩目检六场景过(见「验证」节),改动未提交,待大仙验收后进入发版收口(挂账清单前两行)。
