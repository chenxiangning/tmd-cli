# Changelog: git-right-panel

## 0.3 · 2026-09-02 · 实装完成(待验收)

- 状态 Draft → Implemented:后端 git/ 15 命令 + 前端 src/plugins/git/ 全量面板随 f80b6ce 落地
- 2026-09-02 晚间评审补修:remote_ops 成功路径 join 持锁挂死 → channel + recv_timeout 有限等待
- DoD 手动验收项(9 步验证 / 三平台打包留档 / proposal→Verified)未完成,维持待验收

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
