# git 插件「创建 PR」工作流:预检/推送/建 PR/可选审批评论

状态修订(2026-09-15 晚):范围闸门整体移除(用户决定:PR 内容不做本地限制,错误基线/超大范围交 gh 与 GitHub 裁决);precheck 仅保留 gh 可用性检查,confirmation/fingerprint 字段随闸门删除。
状态:已评审通过(用户批准;AI 生成 v1 不做,进度实时逐阶段)

## 背景与目标

mossx(原 desktop-cc-gui)有一套从 git 面板发起的创建 PR 工作流:确认参数后串行执行预检(gh 可用性 + upstream 范围闸门)、推送、创建 PR(已有 PR 复用)、可选追加审批评论。本仓库 fork 协作场景(upstream → origin)高频需要该能力,目前只能去终端敲 `gh pr create`。

目标:将该能力复刻进 tmd-cli,入口在 git 工具栏视图下拉(差异/分支/历史、平铺/树形 与 刷新/获取/拉取/推送 之间)新增「创建 PR」行。范围:

1. defaults 自动填表:upstream/origin 仓解析(owner/repo)、base 分支推断、head 分支、标题(HEAD commit summary)、描述模板、评论默认 `@<owner> 麻烦审批,已完成验证。`;
2. 四步工作流 Precheck → Push → Create PR → Comment,每步实时推送阶段事件,四张进度卡逐个点亮;
3. ~~范围闸门~~(已随 2026-09-15 晚修订移除:PR 内容不做本地限制,交 gh 与 GitHub 裁决);
4. 凭据失败沿用现有 `isAuth` → 幕布终端引导纪律。

明确不做(v1):AI 标题/描述生成(mossx 走自家引擎同步通道,tmd-cli 无等价物;标题默认取 HEAD commit summary,后续可加)。

## 方案取舍

**选定:git 插件内实现(对话框 + Rust 工作流)。** 入口、cwd、remoteMeta、gitError 分类、远端对话框基建全在 git 插件同域,复用零成本。否决独立 pr 插件:数据同域却跨插件拆分,只会多一层注册与通信,无任何复用收益。

**选定:gh CLI 作为 PR API。** 复刻 mossx 口径:`gh --version` + `gh auth status` 作为预检第一步,PR 创建/查询/评论全走 `gh pr list/create/comment`(无 shell,参数数组)。免 token 管理与存储,登录态由 gh 自己维护。否决 GitHub REST + 自管 token:需要 token 存储与输入 UI,precheck 复杂度不降反升。

**选定:阶段事件实时推送。** 每阶段状态变化 Rust 侧 `app.emit("git://pr-stage", …)`,对话框 listen 后点亮对应卡。否决单次 invoke 等到底:push 大仓库时四卡全灰数分钟,体验差;事件成本低(每阶段一个 emit)。

**~~选定:范围闸门原样复刻~~(已随 2026-09-15 晚修订否决:PR 内容零本地限制)。**

**上下文先例**:mossx 实现位于 `src-tauri/src/git/commands_pr_workflow.rs`(843 行单文件)+ `range_gate.rs` + 前端 `GitHistoryPanelView.tsx`;tmd-cli 按 300 行铁则拆 `pr_gh.rs` / `pr_defaults.rs` / `pr_workflow.rs` 三文件(pr_gate.rs 已随闸门移除),UI 拆 `CreatePrDialog.tsx` + `prDialogModel.ts`。

## 验证

- Rust:`parse_github_repo` 单测(闸门判定已随移除删);`cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`。
- 前端:`prDialogModel` 阶段状态机单测(gate 确认流已随闸门移除删);`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`。
- 目检:`pnpm tauri:dev` 真实窗口,菜单入口、对话框表单、四步卡点亮、gate 横幅确认、结果区复制链接。真实 gh 链路仅验证预检步(`gh --version`/`gh auth status`),创建 PR 走桩目检,不对用户真实仓库误发 PR。
- 提交收口:`npx react-doctor@latest -y` 得分 100。
