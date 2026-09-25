# CLI 学堂(cli-academy)设计 —— 多 CLI 通用的引导学习体系

- 日期:2026-09-25
- 状态:已评审通过(原型 `docs/design/omp-learning-system.html` 定稿,大仙拍板初版实施;分阶段落地,每阶段 reviewer 通过才允许提交)
- 原型:omp 18.3.1 全量 82 条斜杠命令目录(中文一句话 + 「为什么需要它」详解 + 场景/操作/回显/预期四段示例 87 条)+ 13 课入门,浅色基准实测

## 背景与目标

用户对 omp 等 CLI 的了解程度参差,`/` 命令面(omp 82 条)没有任何系统化引导。目标:

1. **指南**:全量命令的可检索参考(中央 tab,按「什么时候需要它」分 10 章),每条命令知其所以然(为什么需要 / 场景化示例 / 预期结果)。
2. **入门课**:13 课覆盖全部章节,每课目标 + 要点 + 终端演示 + 练习;练习「试一试」直接把命令填进 composer 亲手发。
3. **左栏入口**:学堂常驻入口,展示学习进度,进入课程/指南/结业速查。
4. **抽屉增强**:composer 输入 `/` 的候选从 3 条扩为目录全量,描述用中文一句话。
5. **多 CLI 同级架构**(大仙补充铁令):学堂是通用 feature 插件;命令目录与课程是各 cli-* 插件注册的同级知识,omp 只是第一个供给方,后续 claude / codex / pi 零改学堂接入。

## 方案取舍

| 决策点 | 选定 | 被否决及理由 |
|---|---|---|
| 插件形态 | 通用 `academy` feature 插件,消费 kernel 课程注册面 | omp 专属插件:多 CLI 后 UI 逻辑复制 N 份;cli-shared 集中放数据:数据归源 CLI(omp 命令知识不入共享层),单一消费者也不满足 cli-shared「≥2 cli-* 消费」准入 |
| 课程契约位置 | `src/kernel/academy.ts`:AcademyCourse 类型 + 注册表(cli-* 生产者与 academy 消费者的跨插件契约,同 sidebarActions 先例) | 放 cli-shared:它是类型契约不是磁盘格式;kernel 注册面是既有惯例(filePanel/tabs/marketPanel 同型) |
| 左栏入口挂点 | 复用 `leftSidebar.section` 挂点,`order: -1` 排在工作区 section 之前 | 新增 kernel 挂点:现有挂点已覆盖,零内核改动(DesktopColumns.tsx:38 实证渲染位) |
| 指南载体 | 中央 tab(`registerTabContent`,kind `academy.guide`,payload `{cliId}`;tab id `academy:<cliId>`) | overlay:参考书需要与终端并列长驻、多开对比 |
| 入门课载体 | overlay 挂点(session-board/market 同款「不透明覆盖、下层零回放」,order 排在看板之后) | tab:向导是模态语义,不该常驻 tab 条 |
| 数据文件格式 | `.ts` 数据总表 + 文件头 `file-size-exempt`(check-file-size.mjs 注明的「命令面镜像总表」豁免类) | resolveJsonModule:不动共享 tsconfig;拆分多文件:伤目录对照性 |
| 抽屉增强 | cli-omp 的 profile 静态 suggestions 改由课程目录派生(现有 3 条 hardcoded 扩为 82 条,中文一句话作 description;原 3 条 action 语义保留) | composerExt 新触发源:与 CLI-sourced suggestions 同 char 重复合并,复杂度无收益;composer 详情卡 UI 改造:二期(数据面本次已备齐) |
| 练习「试一试」 | `composerInsertRef`(插文本)+ `composerWakeRef`(唤出 `/` 候选),composer 挂载期交接桥,零 composer 改动 | 切换终端视图:composer 常驻可见,无视图切换需求(原型中的 tab 切换是 mock 产物) |
| tmd-cli 接入徽章 | v1 不做。`AcademyCourse.openPanel?` 回调留类型扩展位,只有 cli-* 提供真实打开函数才声明徽章,杜绝假按钮 | 静态徽章无动作:误导(原型里「打开额度面板」在真实客户端无程序化入口) |

## 方案

### 数据契约(kernel/academy.ts,零 CLI 私有知识)

```ts
export interface AcademyExample { sc: string; i: string; o: string; e: string } // 场景/输入/回显/预期
export interface AcademySubCommand { name: string; en?: string; usage?: string }
export interface AcademyCommand {
  name: string; zh: string; en?: string; detail: string; usage?: string;
  how?: string;                       // 在 tmd-cli 里怎么用(静态文案)
  examples: AcademyExample[]; subs?: AcademySubCommand[];
}
export interface AcademyChapter { id: string; title: string; desc: string; commands: AcademyCommand[] }
export interface AcademyLesson {
  id: string; title: string; sub: string; goal: string; points: string[];
  demo?: Array<[cmd: string, out: string]>;   // 终端打字演示
  practice?: string; practiceWhy?: string; cheat?: boolean; // 结业速查课
}
export interface AcademyCourse {
  cliId: string;                      // 对齐 CliProfile.id("omp")
  title: string;                      // "omp 学堂"
  sourceVersion: string;              // 数据提取时的 CLI 版本("18.3.1")
  chapters: AcademyChapter[]; lessons: AcademyLesson[];
  openPanel?: (commandName: string) => void; // 二期:已接入面板的真实打开回调
}
```

注册表同 sidebarActions 纪律:`registerAcademyCourse`(cliId 重复抛错)/`removeAcademyCourse`/`getAcademyCourses`/订阅面;`PluginContext.registerAcademyCourse` 通道。

### 供给方(cli-omp)

- `academy/academyCatalog.ts`:`OMP_ACADEMY_COURSE`(10 章 82 命令,`file-size-exempt`,理由 = 数据总表镜像,拆分伤对照性;头注注明真源与提取法:omp 包 `src/slash-commands/builtin-registry.ts` 的 BUILTIN_SLASH_COMMANDS_INTERNAL,bun 直读,版本 18.3.1)。
- `academy/academyLessons.ts`:13 课(终章 cheat)。
- activate:`ctx.registerAcademyCourse(OMP_ACADEMY_COURSE)`;`OMP_COMMAND_SUGGESTIONS` 改为「原 3 条(保留 action: send 语义)+ 目录派生其余命令(zh 一句话)」,去重合并交给既有 mergeSuggestions。

### 消费方(plugins/academy)

- `index.tsx`:contribute `leftSidebar.section`(order -1,入口)+ `overlay`(order 45,向导)+ `registerTabContent`(guide);`meta.category: "feature"`。
- `academyEntry.tsx`(左栏入口:课程列表 + 进度 + 继续/指南/速查/重置;无课程注册 = 渲染 null)。
- `guideTab.tsx` + `guideCard` 等:搜索过滤 + 章节 chips + 命令卡(详解/四段示例/子命令/在 tmd-cli 里/复制/试一试)。
- `wizard.tsx` + `lessonRail`/`cheatSheet`:13 课向导,终端打字动画,练习试一试。
- `academyProgress.ts`:localStorage(`tmd.academy.progress.v1`,键 `cliId` → `{done: lessonId[], cur}`),纯函数可测。
- `academyStores.ts`:overlay 开关(store 同 boardOverlayStore 先例)、guide tab 打开封装(openTab 唯一定义,同 memory-console consoleTab 先例)。
- `academy.css`:目录卡/速查表等复杂样式(变量全部用 `--tmd-*`,浅深主题自适应)。
- i18n:chrome 文案 `t(中文源串)`,zh 即键缺省回落,en/ja 词典二期随域词典纪律补。

### 契约测试

`src/plugins/tabContent.contract.test.ts`:`OPENABLE_KINDS` 增 `academy.guide`;ctx 桩补 `registerAcademyCourse`。

### 二期(不在本次)

en/ja 词典;composer 抽屉详情卡(四段示例进抽屉);openPanel 徽章;claude/codex/pi 课程接入;课程数据随 CLI 版本探测失效提示。

## 验证

- 单测:kernel 注册表(注册/重复抛错/移除/订阅);academyProgress(done/cur/持久化容错);cli-omp 目录派生 suggestions(全量命令覆盖、无重复、原 3 条语义不变);目录 schema 不变量(章节命令唯一、示例四段齐、lessons 覆盖或 cheat 收尾)。
- 契约:tabContent 双向登记。
- 全量:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`;Rust 零改动。
- 目检(`pnpm tauri:dev` 真窗口):左栏顶部入口出现且进度联动;指南 tab 搜索/卡片/试一试;入门课向导播放/练习/结业速查;composer 输 `/` 候选 82 条中文描述;Esc/×/重置。
- 提交收口:`npx react-doctor@latest -y` = 100。

## 分阶段与 review 门(每阶段 reviewer 通过才允许提交)

1. 阶段 1:kernel/academy.ts + 测试;cli-omp 目录数据 + 注册 + suggestions 派生 + 测试。
2. 阶段 2:academy 插件(入口/指南 tab/进度)+ 契约测试登记。
3. 阶段 3:入门课向导 + 练习桥。
4. 阶段 4:全量验证 + 目检 + react-doctor + `docs/architecture/` 沉淀 + README 状态。
