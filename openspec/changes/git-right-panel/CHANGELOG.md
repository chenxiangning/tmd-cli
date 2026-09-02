# Changelog: git-right-panel

## 0.2 · 2026-09-02 · review 修订 + 迁入仓内 openspec/

- 位置:`tmd-cli-spec/openspec/`(平级)→ `tmd-cli/openspec/changes/git-right-panel/`(仓内维护)
- 修 6×P0:diff/unstage/discard/commit/status/stage 六处实现错误
- 修 6×P1:缓存单层化 / invalidate 删除 / index.read(true) / 命令数 15 统一 / ahead-behind 独立 / 远端凭据防挂死
- 布局:三 Tab → 单视图纵向三段(对齐 codemoss 截图)
- 安全:Composer 联动删 PTY 反射,提交执行权仅面板按钮
- 新增 specs/git-panel/spec.md 能力契约(11 条 Requirement)

## 0.1 · 2026-09-02 · 初稿

- 决策:git2 vendored 替代 shell-out
- 范围:Working/Commit/Branch,Git Graph 排除
