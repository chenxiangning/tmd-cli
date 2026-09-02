# Tasks: Composer 命令抽屉 + 幕布焦点移交

> **标签**:[E] 写代码 · [V] 验证 · [D] 决策评审 · [B] 基线前置
> 交互对照物:`docs/design/composer-drawer-demo.html` v2(含 MCP/插件分区与切换按钮)

---

## 阶段 0:决策与基线

- [x] 0.1 [D] D1~D8 决策评审(proposal §决策);「只读」直删、`/model` 类全 send 已拍板 ✅
- [x] 0.2 [D] action 初判表逐 CLI 过一遍(用户使用直觉校准)
- [x] 0.3 [B] 基线:`pnpm vitest run` / `typecheck` / `check:file-size` / `check:arch-boundary` 全绿留档 —— 2026-09-02 评审拆分 resolve.rs(531 行 → resolve/{mod,path_cache,which})后四件套全绿

## 阶段 1:M1 协议 + resolver(0.5d)

- [x] 1.1 [E] `kernel/cli.ts`:`SuggestionAction`、`CliSuggestion.action/icon/token/group/order`、`CliProfile.listSuggestions` + `listMcpServers`(注释含 D2 判定规则)
- [x] 1.2 [E] `plugins/composer/drawerItems.ts`:resolveDrawerItems(四分区归一 / 静态+动态择一 / null 回退 / 60s 缓存 / 缺省 insert / token 覆盖)
- [x] 1.3 [V] `drawerItems.test.ts` + `drawerPlugins.test.ts`:design §7 清单全绿

## 阶段 2:M2 抽屉 UI + 开关 + tabs(1d)

- [x] 2.1 [E] `drawerIcons.tsx`:语义图标集(含 server/folder/gear/git-branch 等 MCP/插件用)+ kind glyph
- [x] 2.2 [E] `CommandDrawer.tsx`:head/search/分区 tabs/分区列表/foot + 开合动画 + 点外关闭 + Esc/⌘K + 过滤 + ↑↓Enter(demo v2 平移)
- [x] 2.3 [E] 三种点击:send = prepareSendPayload→sessionWrite→toast→延时收起;insert = insertAtCursor 同款+焦点回输入框;open = `filePanel.setFilePanelMode`+toast
- [x] 2.4 [E] `ComposerToolbar.tsx`:「只读」→ 开关按钮(aria-expanded / 无会话置灰 / ⌘K)
- [x] 2.5 [E] `Composer.tsx`:挂载抽屉 + 开合状态提升(开关与抽屉共享)
- [ ] 2.6 [V] 手动对照 demo Step 1-9(proposal §验收)
- [ ] 2.7 [V] 回归:触发符下拉候选与键位行为不变;手敲命令发送无任何拦截

## 阶段 3:M3 幕布焦点移交(0.5d)

- [x] 3.1 [E] `messageAnchors.ts` TerminalHandle + `focus()`;`TerminalView.tsx` 注册处接线
- [x] 3.2 [E] composer 键判定抽纯函数 `resolveArrowIntent` + 接入 onKeyDown(design §6 五行顺序)
- [x] 3.3 [V] 判定顺序单测(IME / 下拉开 / 非空 / 空 × ↑↓)
- [ ] 3.4 [V] 手动 Step 10:空输入 ↑ 幕布聚焦且 CLI 历史可用;非空 ↑ 光标移动

## 阶段 4:M4 数据补齐 + 校准(0.5d)

- [x] 4.1 [E] 7 家 profile 补 `action`/`icon` 声明(claude/omp/pi/grok/kimi/qoder/qoder-cn,按 proposal §初判清单;`/model` 类全 send)
- [x] 4.2 [E] codex 补 suggestions 清单(现状未声明;/model /status /diff /init /compact /review /permissions /skills /mention)
- [x] 4.3 [E] claude + codex 实现 `listMcpServers`(本机实证:`~/.claude.json` mcpServers / `~/.codex/config.toml [mcp_servers.*]`);codex MCP 项 token=`$<name>` insert,claude token=`/mcp` send;qoder 按需 `/mcp-config`
- [x] 4.4 [V] `cli-profiles.contract.test.ts`:send ⊆ bare 合法清单、icon ∈ 语义集、token 项必须显式 action
- [ ] 4.5 [V] 交互式实测校准:逐 CLI 启 TUI 验证 send 项,偏差改回 profile 一行并更新初判表
- [ ] 4.6 [V] 基线四件套重跑全绿;切 CLI 会话抽屉内容随 profile 切换 —— 四件套 2026-09-02 评审后全绿(483 tests);profile 切换仍待手动验

---

## 完成定义

- proposal §手动验收 10 步全过;回归两项零变化;四件套全绿
- 实测校准记录回填 proposal §初判表(标注实证版本)
