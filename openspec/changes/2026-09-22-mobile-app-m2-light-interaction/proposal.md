# M2 轻交互闭环 — mobile app

> 日期:2026-09-22 · 状态:待评审开工
> 上游:总纲 `docs/superpowers/specs/2026-09-21-mobile-app-master-plan.md`(M1 已收口归档);设计 spec `2026-09-21-mobile-app-design.md`;M1 契约 `docs/architecture/12-web-remote-access.md`

## 目标

M1 收口后的业务面 = 「能连上、能看列表与实况」;M2 出口 = **终态验收清单 3、4、6 全绿**:审批卡可应答、composer 手机可发、审批线摘要可见、断线重连不丢内容、凭证进钥匙串、ask/空闲弹本地通知、双通道竞速 + 手动切换。

## 范围边界

| 面 | 做 | 不做(去向) |
|---|---|---|
| 审批应答 | ask 等待卡(允许/拒绝,经 `session_write` 发键,与桌面幕布同 RPC) | 终端键盘全控(M3+ 评估) |
| 审批线 | checkpoint **只读**摘要(读命令进 AppDevice 白名单) | 批次回退/应用等写操作(桌面专属) |
| composer | 窄屏适配(输入框 + 发送;软键盘避让) | 桌面工具栏全量搬移 |
| 凭证 | iOS 钥匙串(原生壳 bridge),localStorage 旧凭证一次性迁移 | Android Keystore(M3 评估) |
| 通知 | 本地通知(UNUserNotificationCenter,壳 bridge):ask 等待 / 会话完成空闲 | APNs 远程推送(个人自用无收益) |
| 通道 | LAN/relay 双 endpoint 竞速 + RemoteHostBar 手动切换 | 自动多路径热切换(单活连接不变) |
| 韧性 | 回前台强制重连 + 磁盘水位回放验证;断连期列表快照保留 | 离线写队列(无写面) |

## 方案取舍

| 决策 | 选定 | 否决与理由 |
|---|---|---|
| 壳能力桥接 | 前端 `kernel/shellBridge.ts`:`__TMD_SHELL__` 态下 `shell.*` 命令走 `window.webkit.messageHandlers.shell.postMessage` → Swift 分发(notify/keychain 两能力);应答经回调注入 `window.__TMD_SHELL_RESULT__` | 把 notify/keychain 做成桌面桥命令 —— 违反「内核不理解 CLI 私有格式 + 壳零业务命令」:这是**手机本机**能力,与桌面无关;也不进 AppDevice 白名单(桌面永远不需要)。 |
| 审批卡数据源 | 复用 kernel `askWatch`(host.appendOutput 主链路驱动,远程态 pty://out 事件同样喂它) | 桌面侧新增 ask 状态 RPC —— 检测已在手机本地跑(字节流 + 屏幕镜像通道随 transport 走),加 RPC 是双份真相。 |
| 审批线摘要 | `conn.rs` AppDevice 白名单 + checkpoint 只读命令(`checkpoint_list`/`checkpoint_detail` 级别,写全拒) | 移动端隐藏审批线 —— spec 终态清单 3 明写「审批线摘要只读可见」。 |
| 钥匙串 | 原生壳 bridge `shell.creds.get/set`(kSecClassGenericAccount,`tmd.mobile.creds.v1`);首启把 localStorage 旧值迁移后删除 | app-group 文件 / Tauri stronghold —— 壳已是原生 Swift,直接 Security.framework 最短路径,零依赖。 |
| 通道竞速 | 配对时 offer 同时存 `{lan, relay?}`;连接序:LAN 3s 超时 → relay;RemoteHostBar 点开 = 手动选路 | 并行拨号择优 —— 双 WS 并连浪费桌面资源且撤销语义复杂化;串行竞速够用(蜂窝下 LAN 必败,超时即切)。 |
| 本地通知触发 | 前端 askWatch 边沿(进入等待/会话转空闲)→ `shell.notify`;系统权限首启配对屏后申请 | 桌面侧推送 —— 无 APNs 凭证链;本地通知覆盖「前台或短暂后台」(spec 措辞),深度后台 = M3 评估。 |

## 风险

| 风险 | 对策 |
|---|---|
| iOS 通知权限被拒 | 静默降级(应用内横幅照旧);设置页给重开指引 |
| 钥匙串在卸载重装后丢(kSecAttrAccessible 语义) | 选 `AfterFirstUnlockThisDeviceOnly`;丢 = 重配一次,M1 语义保底 |
| 软键盘顶起布局(composer 被盖) | visualViewport resize 监听;模拟器不可用 → 真机验收项 |
| checkpoint 读命令暴露路径信息 | 白名单只放**摘要级**命令(列表/统计),文件内容读仍走 fs 只读面既有约束 |

## 验证

- 门禁:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build` + react-doctor 100;Rust 面 `cargo test/clippy/fmt`。
- 真机:iPhone 扫码配对 → 触发 CLI ask → 审批卡应答成功 + 通知弹出;断 Wi-Fi 走 relay;回前台补回放;钥匙串迁移(旧 localStorage 凭证 app 重启仍在线);审批线摘要可见。
- 协议脚本:`web-bridge-client.mjs` 增 checkpoint 只读命令断言(白名单扩面回归)。

任务分解见 `tasks.md`。
