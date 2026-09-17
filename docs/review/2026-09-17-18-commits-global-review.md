# 本地 18 笔整体 Code Review(git 双栏 / web 桥 / kernel 状态 / 看板四域)

日期:2026-09-17 | 状态:已完成(P1×1 + P2×7 全修,P3 一行级批量修,其余留档;门禁全绿 react-doctor 100)

## 范围

`a455375^..98aaf80`(Tmd-0.1.9 本地 18 笔:git 双栏 4 / web 桥 6 / kernel 会话状态 4 / 看板+adapter 2 / docs 2),125 文件 +9889/-520。四域并行独立 review(边界/兼容/性能/准确四维),父会话汇总统一修复。

## 结论

- **P1×1**:e710fc8 误删 `.plugin(tauri_plugin_process::init())` —— relaunch(更新安装后自动重启)必失败,编译无感。已恢复(lib.rs)。
- **P2×7**(全修):
  1. server.rs `select!` else 死分支 + stop 后 socket 保留完整派发权 → reader/writer 订阅后 `borrow_and_update()` 预检,删死 else;
  2. /file 黑名单(仅 .ssh/.aws/.gnupg/.config)漏 .claude/.codex/.local/.netrc/.zsh_history 等 → 改首段 dot 允许制,白名单仅 .tmd-cli/wallpapers;
  3. 部署成功即写 `webRelayOn:true` → 只回填 url/key,违反「webRelayOn 只由 Rust 侧 start/stop 落盘」纪律,防 autostart 静默拨通外网;
  4. web 面镜像 `config_write_settings` 不广播 `settings:changed` → 补 emit(防手机端修改被桌面端全量持久化静默回滚);
  5. 桥绑 0.0.0.0(VPN tun/容器网段可达)→ 改绑 `lan_ip()` 解析值(回落 127.0.0.1),与展示 URL 同源;
  6. 看板 VIEWED_FLASH_MS(2.4s)瞬态窗无到期重算,卡无限期停「结束-已查看」→ useBoardSessions 挂一次性精确定时 bump;
  7. sessionArchive 200 容量逐出 × 自动归档(~10 天触顶)违背「归档标记跨打开/关闭持久」→ makeOverlay 支持 per-layer max,archive 层 2000。
- **P3 已修(一行级)**:wordDiff 注释漂移(实色块);lnoCols `(digits+2)ch` 真余量;BranchView 过滤 useMemo(免无关状态翻转全表重滤);cliProfile busyMarks 悬句补全;16KB→16K 字符口径三处统一(hostSessionServices/cliProfile/08 文档);误锚结算口径「≤30s(自证钟)」;pi/kimi busyMarks/idleMarks 待实采注记;CalendarGrid maxDay 只归一当月格;dayOpen 打开失败回滚归档(防注意力信号静默丢失);session-board 3 个死 i18n 键删除;AGENTS.md R3 行补 transport.ts;check-file-size 豁免口径承认「同源移植/命令面镜像总表」类;WebRelayCard 事件注释漂移;风险弹窗去「per-device approval」虚诺,改如实机制(密钥即凭据/重启重铸)。
- **P3 留档(未动,升级路径在案)**:Worker `timingSafeEqual` 纯纵深(改 Worker 源码须同步 zip 同字节,单独一笔);中继每帧 b64+JSON ~1.78× 膨胀(大文件再上二进制帧);每 WS 帧无条件 spawn + body 无上限(公网 DoS 资源耗尽,鉴权兜底;上每连接并发上限 + body 上限);relay start/stop 无 transition 互斥(小窗口错误自显无自愈);`web://access` 事件全仓无消费者(桥启动失败 UI 无提示);绑定前活/盘双卡窗口(<2s);allMode 全远程空态;SSH 引擎会话入板口径;板开期间会话开关全量重扫(与侧栏同源);eprintln 已不打 token。
- **四域独立结论**:git 域(词级 DP 预计算真修、两态标注一致、CSS 类零残留)/ kernel 域(kernel 零 CLI 字面量、onOutput 尾参兼容、账本脏数据 fail-open)/ 看板域(19 文件零越界全经 activate 注册面、五态定稿语义全部核实)/ web 域(transport 纯传输 R3 例外成立、两笔竞态修复真闭环、token/relay-key 强度与 Worker 鉴权自洽)—— 各维未发现问题项均附依据。

## 方案取舍

- 分支过滤 memo / lnoCols 等一行级 P3 随批修:成本一行,收益真实(万级 refs 可感);
- Worker 源码类 P3(timingSafeEqual/文案)不动:`deploy/worker/src/index.js` 与导出包 zip `include_str` 同字节契约,改动须单独一笔同步;
- B 端瞬态窗选「一次性精确定时」而非 1s 心跳:无空转,窗满即重算。

## 验证

`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build` + `cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check` + `npx react-doctor@latest -y`(100)全绿;P1/P2 修复明细内联于代码注释与 architecture/12 号文档。
