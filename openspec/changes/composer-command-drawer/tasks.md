# Tasks: Composer 命令抽屉 + 幕布焦点移交

> **标签**:[E] 写代码 · [V] 验证 · [D] 决策评审 · [B] 基线前置
> 交互对照物:`docs/design/composer-drawer-demo.html`

---

## 阶段 0:决策与基线

- [ ] 0.1 [D] D1~D5 决策评审(proposal §决策);确认「只读」直接删除不迁移
- [ ] 0.2 [D] action 初判表逐 CLI 过一遍(用户使用直觉校准)
- [ ] 0.3 [B] 基线:`pnpm vitest run` / `typecheck` / `check:file-size` / `check:arch-boundary` 全绿留档

## 阶段 1:M1 协议 + resolver(0.5d)

- [ ] 1.1 [E] `kernel/cli.ts`:`SuggestionAction`、`CliSuggestion.action/icon/group/order`、`CliProfile.listSuggestions`(注释含 D2 判定规则)
- [ ] 1.2 [E] `plugins/composer/drawerItems.ts`:resolveDrawerItems(分区派生 / 静态+动态择一 / null 回退 / 60s 缓存 / 缺省 insert)
- [ ] 1.3 [V] `drawerItems.test.ts`:design §6 清单全绿

## 阶段 2:M2 抽屉 UI + 开关(1d)

- [ ] 2.1 [E] `drawerIcons.tsx`:语义图标集(对齐 design §3 初步清单)+ kind glyph
- [ ] 2.2 [E] `CommandDrawer.tsx`:head/search/分区列表/foot + 开合动画 + 点外关闭 + Esc/⌘K + 过滤 + ↑↓Enter(demo 平移)
- [ ] 2.3 [E] send 执行:prepareSendPayload → sessionWrite → toast → 延时收起;insert 执行:insertAtCursor 同款 + 焦点回输入框
- [ ] 2.4 [E] `ComposerToolbar.tsx`:「只读」→ 开关按钮(aria-expanded / 无会话置灰 / ⌘K)
- [ ] 2.5 [E] `Composer.tsx`:挂载抽屉 + 开合状态提升(开关与抽屉共享)
- [ ] 2.6 [V] 手动对照 demo Step 1-6(proposal §验收)
- [ ] 2.7 [V] 回归:触发符下拉候选与键位行为不变

## 阶段 3:M3 幕布焦点移交(0.5d)

- [ ] 3.1 [E] `messageAnchors.ts` TerminalHandle + `focus()`;`TerminalView.tsx` 注册处接线
- [ ] 3.2 [E] composer 键判定抽纯函数 `resolveArrowIntent` + 接入 onKeyDown(design §5 五行顺序)
- [ ] 3.3 [V] 判定顺序单测(IME / 下拉开 / 非空 / 空 × ↑↓)
- [ ] 3.4 [V] 手动 Step 7-8:空输入 ↑ 幕布聚焦且 CLI 历史可用;非空 ↑ 光标移动

## 阶段 4:M4 数据补齐 + 校准(0.5d)

- [ ] 4.1 [E] 7 家 profile 补 `action`/`icon` 声明(claude/omp/pi/grok/kimi/qoder/qoder-cn,按 proposal §初判清单)
- [ ] 4.2 [E] codex 补 suggestions 清单(现状未声明;/model /status /diff /init /compact /review /permissions /skills /mention)
- [ ] 4.3 [V] `cli-profiles.contract.test.ts`:send ⊆ bare 合法清单、icon ∈ 语义集
- [ ] 4.4 [V] 交互式实测校准:逐 CLI 启 TUI 验证 send 项(尤其 /model picker 类),偏差改回 profile 一行并更新初判表
- [ ] 4.5 [V] 基线四件套重跑全绿;切 CLI 会话抽屉内容随 profile 切换

---

## 完成定义

- proposal §手动验收 8 步全过;回归三项零变化;四件套全绿
- 实测校准记录回填 proposal §初判表(标注实证版本)
