## 变更说明

<!-- 改了什么、为什么。一句话结论先行。 -->

## 变更类型

- [ ] 新功能(feature)
- [ ] 缺陷修复(fix)
- [ ] 文档(docs)
- [ ] 重构(refactor)
- [ ] 构建 / CI(chore)

## 自查清单

- [ ] 提交信息符合 `type(scope): 中文一句话祈使句`
- [ ] 前端改动:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build` 全绿
- [ ] Rust 改动:`cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check` 全绿
- [ ] UI 行为改动已 `pnpm tauri:dev` 真实窗口目检
- [ ] 新增 / 修改文档已在 `docs/README.md` 索引表登记
- [ ] 未违反架构铁则(500 行 / R1 / R3 / R4)
