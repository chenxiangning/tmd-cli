# 系统通知与额度撞墙预警(离开工位盲区收口)

> 日期:2026-09-26 · 状态:已落地(真机目检待大仙)
> 上游:能力盘点 `docs/research/client-capability-gap-analysis.md`(P0-1 桌面 OS 通知 + P0-3 中的预警半件;手机推送为二期,不在本变更)

## 目标

「走开 → 回来发现卡在等审批/早已撞墙」是六类痛点里证据最强的一类(盘点 §2.5)。桌面在窗口失焦时把关键事件送出窗口:Ask 等待确认、轮次结束(未查看)、会话退出(默认关)、额度过阈预警。检测零新增——纯消费内核既有信号。

## 范围边界

| 面 | 做 | 不做(去向) |
|---|---|---|
| 事件侧 | askDetected / turnSettled(unviewed)/ sessionExited 三边沿,失焦才发 | 新检测通道——askWatch 双通道已在,双份真相 |
| 额度侧 | 激活会话供应商 10 分钟轻轮询(kernel/quota 注册表复用,与 QuotaChip 同通道),窗口已用 % ≥ 阈值发一次/窗口周期 | 全凭据并发轮询(频控风险);余额型供应商(无窗口);跨凭据聚合水位 |
| 通道 | tauri-plugin-notification,Rust builder 注册 + kernel/ipc 薄包装(R3) | 手机推送(APNs/FCM/中继哑通知)——二期;web 态恒不发射 |
| 交互 | 通知即发即忘;设置分区三开关 + 阈值(0 = 关) | 点击通知聚焦会话(插件通知点击路由跨平台语义不一,待真机验证后再议);通知内按钮 |

## 方案取舍

| 决策 | 选定 | 否决与理由 |
|---|---|---|
| 焦点闸 | kernel/host 增 `isWindowFocused()` 公共读口(单一真相) | 插件自挂 blur/focus——与 main.tsx 馈入 host 的既有焦点态形成两份真相 |
| 额度轮询挂点 | notify 插件内 setInterval(10 分钟)+ 首查 30s | 挂 QuotaChip 边沿事件——chip 仅按需抓取(无周期刷新),离开时恰无抓取;独立轻轮询才覆盖"离开期间烧穿"场景 |
| 去重键 | `${窗口标签}:${resetsAt ?? 0}` 集合,插件生命周期内一份 | 持久化已提醒态——重启多提醒一次无害,持久化反增清理负担 |
| turnSettled 过滤 | 仅 unviewed=true 的结算 | 查看过的轮次也提醒 = 骚扰,与未读语义重复 |
| 开关默认 | Ask/轮次结束开,会话退出关,阈值 10% | 会话退出高频且常是用户自己关的;全部默认开会变成通知骚扰 |

## 风险

| 风险 | 对策 |
|---|---|
| 通知风暴(多会话同刻结算) | macOS/Win 系统级堆叠 + 失焦闸 + 默认仅两类;真机手感待目检,必要时加全局节流 |
| 额度 API 频控 | 10 分钟单供应商单请求(与 QuotaChip 同级);失败静默(chip 已有失败警示) |
| macOS 权限拒后静默失效 | sendOsNotification 恒返 bool,拒绝/异常吞掉不弹错;设置页开关语义不受影响 |

## 验证

- 门禁:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build` + cargo clippy/fmt/test + react-doctor 100。
- 单测:`notify.test.ts`(发送闸三态/文案命名链/阈值判定与去重键)。
- 真机:`pnpm tauri:dev` 失焦后触发 Ask/轮次结束/额度(手调阈值 1)三路通知,由大仙目检。
