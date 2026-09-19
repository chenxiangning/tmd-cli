# 提案:会话状态轮询性能批次一(尺寸闸 + home 目录缓存)

## Why

状态巡航(`SessionStatusWatch.ensurePolling`)每 2s 对**活跃会话**执行一轮「定位文件 → 读 256KB 尾窗 → 解析」。实测该轮的真实成本被低估:

1. **omp/pi 路径每拍先跑 `fs_collect_files`**:两家共享全局会话目录(`~/.local/share/omp/projects` 等单目录存全部工作区会话),库内数千文件时一拍 = readdir + 全目录逐文件 stat(mtime 排序所需)+ 排序。这比 256KB 尾读更重,且**每 2s 一次持续发生**,与用户是否在等模型无关。
2. claude/qoder 路径每拍一次 `fs_read_tail` 256KB 读 + IPC String 分配。
3. 解析(`parseJsonlStatusTail` 全窗倒序扫)每拍 1-3ms。

合计:应用开着就持续 ~0.3MB/s 级 IPC 流量 + 每拍数 ms 解析,桌面挂机整天即数百 MB 无效 IO。battery / 低配机 / Windows 有感。

同批顺手:`ipc.configHomeDir` 47 处调用方(每次扫描、配额、编辑、GUI 配置都重新取),值每进程恒定,纯浪费 IPC。

既有闸门(本提案不动的部分,已核实):`applyObserved` 有值变更闸(值不变不 notify 不重渲);activityWatch 呼吸灯 500ms 节流;侧栏分页预算钉住行数。

## What Changes

### 1. `fs_read_tail_changed`:通用 fs 原语(Rust)

```rust
fs_read_tail_changed(path: String, max_bytes: usize, last_size: Option<u64>) -> ChangedTail
// ChangedTail { changed: bool, size: u64, text: String }
// last_size = Some(n) 且当前 len == n → { changed: false, size: n, text: "" }
// 否则 → { changed: true, size: len, text: read_tail(path, max_bytes) }
```

- 通用原语,零 CLI 语义(stat + 条件尾读),与 fs_read_tail 同层(`fs.rs`)。
- 挂载点:`lib.rs` invoke_handler 一行;web 桥 `web/dispatch_fs.rs` 一臂(OnePath 复用扩字段),保持 web 远程访问面同权。
- 单 IPC 完成探测+读取(变化拍),未变化拍 1 IPC 零读。

### 2. 三家状态读取接尺寸闸(TS)

`cli-shared/sessionStatus.ts` 增加共享闸缓存(path → {size, result}),omp/pi(`readJsonlSessionStatus`)、qoder、claude 三家 `readSessionStatus` 接入:

- 命中缓存 → `fs_read_tail_changed(cachedPath, 0, lastSize)` 探测;尺寸未变直接返回缓存解析产物(**免列目录、免读、免解析**)。
- 尺寸变 → 走原全路径(列目录/直拼路径 → 读 256KB → 解析),回填缓存。
- 探测 IPC 失败(文件被移走等)→ 回落全路径,自愈。
- claude 直拼路径免列目录;omp/pi/qoder 的列目录只发生在尺寸变的那一拍。

### 3. `configHomeDir` 进程级 memo(kernel/ipc.ts)

`configHomeDir()` 改为 once-Promise(拒绝时复位重试,成功后进程内复用)。47 处调用方零改动受益。先例:`assets/store.ts` 的 `tmdHome()` 已同款 memo。

## 方案取舍

| 被否决方案 | 理由 |
|---|---|
| **B:字节偏移增量读**(记录上次偏移,只读新增字节,窗口滚动拼接) | 字节偏移经 `from_utf8_lossy` 后 JS 侧不可靠(FFFD 替换破坏字节计数);跨拍读边界会切断多字节字符与行,把 FFFD 烧进窗口中段——今天解析器只容忍**窗口首行**截断,中段损坏 = 状态事件丢失,语义回归。需要 Rust 返回字节精确偏移 + 行对齐修剪,复杂度数倍于收益。 |
| 只加 `fs_file_size` 探测原语,变化拍再独立 `fs_read_tail` | 变化拍 2 次 IPC;单命令 `fs_read_tail_changed` 1 次完成,原语仍通用。 |
| memo 下放到各调用方(47 处改写) | 机械大 diff;ipc 层一处 memo 全量受益,与既有 `tmdHome()` 先例同构。 |
| 通知风暴细粒度化(useHost 分域) | 本批**不做**:收益未测量(Safari inspector timeline 占比),且漏订阅风险 > 过度渲染。见「明确不做」。 |

**尺寸闸的正确性前提**(如实声明):会话日志为 append-only,内容变化 ⇒ 尺寸变化。同尺寸原地替换不属于任何 CLI 会话日志的写行为(omp/pi/claude/qoder 均纯追加;resume 另起新文件新 cliSessionId,闸键自然失效)。闸缓存只存 `{path, size, result}`,单条 ~200B,千级死会话 <1MB,不设上限。

## 老功能覆盖校准

| 原行为 | 新行为 | 校准 |
|---|---|---|
| 每拍全路径:列目录 → 读尾 → 解析 → applyObserved | 首拍同原路径建缓存;后续未变拍返回同输入的同解析产物 | 解析输入逐字节相同(同 256KB 窗口语义,不引入增量窗口),`parseJsonlStatusTail` 契约(倒序首遇 / model_change 跨事件裸名确认 / 首行截断容错)零触碰 |
| 会话无状态事件时每拍重读重解析(重试追赶) | 尺寸没长 = 内容没变,返回同 null;文件追加后下一拍自动全路径重试 | 追赶语义不变,只是重试粒度从「每拍」变「每字节变化」——事件落盘必增尺寸 |
| 文件被删/挪后探测失败 | 缓存探测失败 → 清缓存走全路径 → 列目录找不到 → null,与今天一致 | 自愈路径保留 |
| resume 新开日志文件(cliSessionId 变) | 闸键含 cliSessionId,天然 miss,首拍全路径 | 无陈旧缓存风险 |
| `read_tail` 首行截断/FFFD 容错 | `read_tail_changed` 复用同一 `read_tail` | Rust 侧行为逐字节一致;Rust 单测覆盖 None/same/grow/shrink 四态 |
| web 远程访问面可调 fs 域命令 | `dispatch_fs.rs` 同步挂新命令臂 | web 会话状态轮询同享优化,无功能缺口 |
| 单测 mock `ipc.fsReadTail` 断言 | 命令面换 `fsReadTailChanged` | 既有 sessionStatus/qoder 测试随契约更新(预期破坏,非回归) |
| configHomeDir 每次真调 invoke(含失败重试) | 成功后进程内复用;拒绝不复位会卡死 → 实现 catch 复位,失败语义与今天一致(每次重试) | 47 处调用方零改动;vitest 全量 mock `@kernel/ipc`,memo 不入测试路径 |

## 明确不做(本批)

- **host.notify 分域**(候选③):先测量(Safari inspector timeline,占比 <5% 不做),另批。
- **平铺显式切换 portal 化**(候选④):用户主动换版式的已知行为,大工程,收反馈另案。
- **codex/kimi 状态读取接闸**:codex rollout 状态逻辑(近 8 文件回扫)与 kimi 适配器实现需单独摸排,列后续批次;omp/pi/claude/qoder 已覆盖全部「每 2s 活跃会话轮询」主力路径。
- 状态轮询 2s 周期本身:不动(活动语义依赖)。

## Impact

- **Rust**:`fs.rs`(+`read_tail_changed` ~20 行 + 单测 4 态)、`commands_fs.rs`(+命令壳)、`lib.rs`(+1 行注册)、`web/dispatch_fs.rs`(+1 臂 + args 结构)。
- **TS**:`kernel/ipc.ts`(configHomeDir memo + `fsReadTailChanged` 命令面)、`cli-shared/sessionStatus.ts`(闸缓存 + omp/pi 接入)、`cli-shared/qoderSessionModel.ts`、`cli-claude/index.tsx`;对应测试更新 + 闸行为新测。
- **门禁**:前端五件套 + react-doctor 100;`cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`。
- **文档**:落地后按惯例归档并在 `docs/README.md` 登记本提案。

## 验证

1. Rust 单测:read_tail_changed 四态(None 首读 / 同尺寸短路 / 增长全读 / 收缩判变)。
2. vitest:闸命中(二次调用零列目录零读)、尺寸变全路径、探测失败自愈、null 结果同样入闸;configHomeDir memo 成功复用/拒绝复位。
3. 桩目检:活跃 omp 会话挂机 30s,`window.__ipcLog` 中 fs 域命令频率从「每拍 collect+read」降为「每拍 1 次 read_tail_changed」。
