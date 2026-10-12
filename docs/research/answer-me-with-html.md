# answer-me-with-html 能力调研与 tmd-cli 结合分析

**结论:tmd-cli 侧零改动即可用。** 该项目是一个标准形态的 Agent Skill(SKILL.md + 自带 CLI),tmd-cli 托管的十家引擎天然是它的宿主;唯一动作是把 skill 装进引擎技能目录(推荐 `~/.agents/skills` 公约位,一份八家生效)。页面由 CLI 在 PTY 子进程内直接调系统浏览器打开(`open` 配置默认 true),体验完全发生在幕布之外,PTY 零触碰,不违反幕布铁则。进阶路径走 skill-hub 管理面分发(能力已具备)与 `am serve` 远程/手机场景。本机已于 2026-10-12 安装:公约位 `~/.agents/skills/answer-me-with-html` + claude symlink,冒烟渲染通过(Node v22.22.3,0.16s 出页)。

## 一、项目是什么

QingYunA/answer-me-with-html(v0.5.1,MIT,需 Node >= 20):一个 Agent Skill,遇到复杂问题时 agent 不输出文字墙,而是产出**一页单文件离线 HTML**。分工是:模型只写一份 Markdown 稿件(扩展语法:frontmatter + `##` 面板 + `flow`/`sequence`/`er`/`tree`/`timeline` 等图组件),自带的 CLI(`am`,单文件 `scripts/am.mjs` 780KB,零依赖零安装,marked + dagre + temml 已打包)负责模板、面板排布、SVG 坐标计算、主题与亮暗、STE 写作检查。

上游实测数据(其 bench 声明可复现):模型输出 token 约为直接手写 HTML 的 1/8(612 vs 4893),耗时约 1/2.6(12s vs 31s)。运行时只在渲染那一发 bash 调用里存在,不驻留。

关键特性(与使用决策相关):

- **出错自纠回路**:稿件写错时 CLI 输出 `✗ L<行号> [组件]` + 正确示例,agent 照改重渲;`--replace` 保证一答一页。
- **真实代码引用**:代码块 `src=path lines=18-30` 直接从项目文件取真实代码,拒绝 cwd 外文件与疑似密钥文件。
- **页面可回复**:页面右上角 Reply 按钮,读者对任意面板评论、在 `ask` 组件里选选项,合成 `# Re: <标题>` 文本贴回给 agent;`am patch` 可单面板更新已生成页(源稿内嵌在页面 `#am-source`)。
- **单文件离线**:产物不引用任何 CDN/外部字体,断网可开,可直接发人。
- **解释视频**:`am video` 把带旁白的稿件做成 3b1b 风格播放页(图随旁白画、镜头跟节点),可导出 WebM/MP4;仅显式要求才做。
- **宿主面**:Claude Code / Codex / Cursor / OpenCode / Pi 等一切能跑 shell 的 agent——skill 就是目录,与引擎无关。

## 二、怎么用

### 安装(四条路,任选)

| 方式 | 命令 | 说明 |
| --- | --- | --- |
| 交给 agent 装 | 让 agent 读上游 INSTALL.md 照做 | 全程无交互,装完用 TCP 页验证 |
| 一条命令 | `npx skills add QingYunA/answer-me-with-html` | vercel-labs/skills 安装器,问装到哪个 agent |
| Claude Code 插件 | `/plugin marketplace add QingYunA/answer-me-with-html` + `/plugin install ...` | 走 Claude Code 插件市场 |
| 手动 | 把仓库 `skills/answer-me-with-html/` 目录 cp 进引擎技能目录 | 目录名 = skill 名 |

引擎技能目录与 tmd-cli 的十引擎扫描表(`src/plugins/cli-shared/skillSources.ts`)**同构兼容**:claude `~/.claude/skills`、codex `~/.codex/skills`、omp `~/.omp/agent/skills`、pi `~/.pi/agent/skills`、kimi `~/.kimi-code/skills`、grok `~/.grok/skills`、qoder `~/.qoder/skills`、opencode `~/.config/opencode/skills`、dsh `~/.dsh/skills`、公约位 `~/.agents/skills`。差异一处:上游 README 手动安装段写 opencode 目录为 `~/.config/opencode/skill`(单数),opencode 引擎真实读取目录未核,经 skill-hub 导入 opencode 前先确认。

### 在 agent 里用

装好后正常提问即可("讲讲 TCP 三次握手""这个仓库模块怎么组织的""Redis 和 Memcached 怎么选");agent 按「≥3 个关联概念 / 有流程或状态迁移 / 多维对比 / 层级或演化」自判出页,也可明说"用 HTML 讲一下"。一句话能说清的问题不出页。

要点:

- agent 的调用形态是 heredoc 一发渲染:`node <skill目录>/scripts/am.mjs render - <<'AM_EOF' ...`;SKILL.md 用 `${CLAUDE_SKILL_DIR}` 占位,**非 Claude Code 宿主需替换为 skill 目录绝对路径**(SKILL.md 已声明此约定)。
- 高频模式(可选,推荐):往规则文件(CLAUDE.md/AGENTS.md)加一条 `[answer-me-with-html always-on]` 规则(README 有现成原文),每个结论附 2~4 面板小页、`--no-open` 不弹窗、回复末行附 file:// 链接。
- 配置:`~/.answer-me-with-html/config.json`,`am config set <key> <value>`;键有 `open`(默认 true,自动开浏览器)、`theme`(auto/blueprint/shadcn/paper/自定义)、`mode`、`style`(STE 严格度,默认只提醒)、`update_check`、`voice`(视频配音)。
- 直用 CLI(不经 agent):`am render notes.md` / `am patch page.html --panel "标题"` / `am lint` / `am list` / `am config`;页面落 `~/.answer-me-with-html/pages/`,`AM_HOME` 可改;`am clean` 清 30 天前旧页。

## 三、与 tmd-cli 结合

### A. 零改动直用(推荐,今天可用)

1. **装一份进公约位**:`skills/answer-me-with-html` 目录放进 `~/.agents/skills/` —— tmd-cli 十引擎表中 codex/omp/pi/kimi/grok/qoder/opencode/dsh 八家 `readsShared: true` 同时生效;claude 另放 `~/.claude/skills/`(或靠 claude 官方 symlink 支持)。
2. **幕布照常,浏览器自动弹**:tmd-cli 会话里提问 → 引擎经 skill 调 `am render` → CLI 进程直接 `open`(darwin)/`xdg-open`/`cmd start` 打开页面(`src/config.js` `open` 默认 true)。页面体验不经过幕布,完全符合「一切增强发生在幕布之外」铁则,PTY/内核零改动、零感知。
3. **file:// 链接在幕布内不可点,但不需要**:tmd-cli 终端链接通道(`src/kernel/terminalLinks.ts` 注册表)现仅 marks 一个 provider + WebLinksAddon,无 file:// provider,agent 回复里的链接只是文本。自动弹窗已兜底;若想要可点击,是「注册一个 file:// link provider」级别的小插件活,非必须,不建议为它立项。

### B. skill-hub 管理面分发(轻胶水,能力已具备)

skill-hub 的导入视图(ImportView)以十引擎扫描层为源:把 skill 目录放进任一被扫目录,skill-hub 面板即出卡,导入弹窗可多选引擎落位 + 公约位 + claude 补链;composer 技能唤醒抽屉共用同一发现层(cli-shared/skillSources),自动可见。ClawHub 商店源(`clawhub.ts`)是上游商店,answer-me-with-html 是否上架未核;不上架不影响本地导入链。多机一致性问题(每台机器各装一份)由 skill-hub 逐机操作解决,无远端分发需求。

### C. 远程与手机场景(ssh / wsl / mobile)

- ssh/wsl 远程会话里跑引擎时 file:// 打不开 → 官方走法 `am serve`(默认 `127.0.0.1:8765`,HMAC 逐页令牌,仅 loopback;render 会多输出一行 `link:`,agent 回 URL 替代 file://)+ 本机 `ssh -L` 隧道;`--lan`/`--public-url` 是明文自担的显式选项。
- 与手机树(mobile)结合:tmd-cli mobile 外网访问调研(docs/research/mobile-remote-access.md)已有「LAN 桥/通道」形态,`am serve --lan` 或反代后,手机聊天里贴出的 http 链接由手机浏览器直开。mobile 会话屏对 http 外链的渲染处理未实测,保底复制链接到浏览器。
- 注意 `am serve` 默认只监听 loopback、令牌即凭证,不要为「方便手机看」轻率开 `--lan`。

### D. 明确不做

- **不把 HTML 渲染进幕布/气泡**:PTY 幕布硬约束,页面归浏览器。
- **不让内核或文件插件特判 `~/.answer-me-with-html`**:内核不理解 CLI 私有格式;页面生命周期(am clean)归 am 自己管,tmd-cli 无需染指。
- **不改造/fork/移植 skill 本体**:标准 skill 形态,委托给引擎即可——与 docs/research/skill-mcp-integration-architecture.md 已定的「委托 CLI」路线完全一致。

### E. 可选后续(不承诺,一行 backlog 级)

- docgen(architecture/22)未来若要「生成文档 → 可视化页」分发形态,am 稿件是现成通道之一。
- always-on 高频模式规则写入用户全局规则文件,由大仙拍板是否开。

## 四、验证与风险

事实来源(全部实读,2026-10-12):

- answer-me-with-html 仓:README.zh-CN.md、SKILL.md、docs/reference.zh-CN.md、`src/config.js`(open 默认 true)、`src/serve.js`(8765/逐页 HMAC 令牌/serve.json)、`package.json`(v0.5.1,bin am)。
- tmd-cli 仓:`src/plugins/cli-shared/skillSources.ts`(十引擎表/INSTALL_ENGINES/readsShared)、`src/plugins/skill-hub/`(install.ts 落位语义、ImportView、clawhub.ts)、`src/kernel/terminalLinks.ts` + 全仓 grep(`registerTerminalLinkProvider` 仅 marks 注册)。
- 本机状态实查:`~/.claude/skills` 等 5 个目录无 answer-me-with-html,`~/.answer-me-with-html` 不存在,无 `am` 全局 bin。

- 安装核验:2026-10-12 `cp -R` 进 `~/.agents/skills/` + `~/.claude/skills/answer-me-with-html` symlink;`am.mjs render - --no-open` 冒烟 `✓` 0.16s(Node v22.22.3,blueprint sheet 1 panel,STE 0 warnings)。

其余未验证项:「1/8 token、50ms」等数字转引自上游 bench;opencode 引擎技能目录单复数;answer-me-with-html 是否在 ClawHub 上架。
