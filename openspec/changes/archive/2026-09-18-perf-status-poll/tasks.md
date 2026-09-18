# Tasks:perf-status-poll

## Rust

- [x] `fs.rs`:`read_tail_changed(path, max_bytes, last_size: Option<u64>) -> Result<ChangedTail, String>`,复用 `read_tail`;单测四态(None 首读 / 同尺寸短路 / 增长全读 / 收缩判变)。
- [x] `commands_fs.rs`:`fs_file_size` 不做,直接 `fs_read_tail_changed` 命令壳(spawn_fs 纪律)。
- [x] `lib.rs`:invoke_handler 注册。
- [x] `web/dispatch_fs.rs`:新命令臂 + args 结构(camelCase maxBytes/lastSize),web 面同权。

## TS

- [x] `kernel/ipc.ts`:`fsReadTailChanged` 命令面;`configHomeDir` once-Promise memo(拒绝复位)。
- [x] `cli-shared/sessionStatus.ts`:闸缓存 + `readJsonlSessionStatus` 接入(omp/pi)。
- [x] `cli-shared/qoderSessionModel.ts`:状态读取接闸。
- [x] `cli-claude/index.tsx`:`readClaudeSessionStatus` 接闸(直拼路径)。
- [x] 测试:闸命中/尺寸变/探测失败自愈/null 入闸;sessionStatus、qoder 既有 mock 随契约更新。

## 门禁

- [x] 前端:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build` + react-doctor 100。
- [x] Rust(src-tauri/):`cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`。
- [x] 桩目检:挂机 30s 观察 ipcLog,fs 域每拍仅 1 次 read_tail_changed。
- [x] 归档登记 docs/README.md。

## 批次二(2026-09-18 追加)

- [x] 引擎摸排:codex/grok/opencode/kimi/dsh 五家状态读取形态
- [x] codex 接闸(同 omp/pi 闸型:resolver 定位 + path/size 暂存,命中拍免 collect/head/tail;head 的 model/modelId 兜底随定位拍暂存,解析优先级与旧实现逐位对齐)
- [x] 摸排结论(不动):grok 读 summary.json 小文件;opencode 两条轻量 sqlite(LIMIT 1);kimi 读配置文件不碰会话尾读;dsh 走 RPC 无磁盘 IO
- [x] 回归:codex 闸命中拍免列目录用例;既有 omp/pi/claude/qoder 闸用例不回归
