## Context

tmd-cli 的所有 PTY 输出唯一汇聚点是 `kernel/host.ts#appendOutput`：它维护每会话环形缓冲、发布 `ptyLiveTopic` 实时事件，并用 `activeTurns` + 1Hz 活动守望实现"2s 输出静默 = 一轮对话结束"的轮次模型（未读蓝呼吸依赖它）。CLI 的 Ask/确认面板（omp Ask、claude 权限确认等）本质是终端文本输出，可在此层检测。

codemoss 已有成熟的声音播放实现（`notificationSounds.ts`：懒加载 wav + `new Audio`），tmd-cli 同为 Tauri + WebView 架构，可直接借鉴其播放策略与设置三件套形态。

## Goals / Non-Goals

**Goals:**
- CLI 阻塞等待用户确认（Ask/权限/y-n 面板）时播放提示音，每轮最多一次
- 设置页「行为」tab 可配置：开关（默认开）、音效（默认/风铃/铃声/叮咚）、测试按钮
- 零新增 CSS、零新增依赖；设置 JSON 向后兼容

**Non-Goals:**
- 不做自定义音频文件（`convertFileSrc` 违反 R3 需开专门通道，YAGNI）
- 不区分前台/后台窗口（响一次成本低，误打扰收益比不划算）
- 不引入 Linux WebKitGTK 播放防护（当前交付面为 macOS；跨平台时再引入 codemoss 的 skip 策略）

## Decisions

1. **观察点在 PTY 输出流**：`ipc.onPtyOutput` 按会话主题的多订阅者 listen 形态，askSound 以第二观察者身份
   接入，前台/后台会话全覆盖，与幕布是否挂载无关 —— host 的 appendOutput 主链路零改动。
2. **跨 chunk 安全的标记匹配**：每会话保留 240 字符原始尾巴，新 chunk 拼接后先剥 ANSI 转义（CSI/OSC/单字符）再跑标记正则；尾巴存原始文本使被截断的转义序列在下一轮拼接时自然复原。
3. **标记集为单一正则常量**：`Ask \d+ questions?`、`Enter select`、`Esc (to )?cancel`、`\(y/n\)`。保守选词（UI 页脚/面板标题字面量），助手正文误报概率极低；扩展只需改正则。
4. **去重语义 = 每轮一次**：命中标记且本轮未响过 → 播放并置位；轮次边界由模块内**惰性判定**——
   与 host 活动守望同阈值（输出静默 >2s = 新一轮），去重标记只在输出到达时读写，无需独立计时器。
5. **host 零改动接线**：`bootAskSound`（main.tsx 调一次）订阅 `sessionsChanged` 差分挂
   `ipc.onPtyOutput` 第二观察者 + `sessionExited` 即时清理 —— 输出汇聚点的既有事件形态
   （按会话主题的多订阅者 listen）天然支持，热点文件 host.ts 不增一行。
6. **播放策略照搬 codemoss**：`import("*.wav?url")` 懒加载（不进主 chunk）+ promise 缓存（失败逐出重试）+ `new Audio(url).play()`（catch 吞错不抛）。
7. **设置字段**：`askSoundEnabled: boolean`（默认 `true`）、`askSoundId: "default" | "chime" | "bell" | "ding"`（白名单清洗，非法回落 `default`）。
8. **UI 复用现有组件**：pref-row + segmented（开关）+ 数字输入同款内联样式的 `<select>` + 测试按钮，零新增 CSS。

## Risks / Trade-offs

- **TUI 全屏重绘类 CLI**（未来接入）可能在无事件时重放标记文本 → 同轮去重已挡住；跨轮重绘会再响一次，属可接受噪声。
- **误报**：终端里出现同字面量（帮助文本、聊天内容引用）→ 触发一次提示音，成本可接受；标记集保持保守。
- **wav 资产 ~170KB**：懒加载后只在首次播放拉取，不占主 chunk。
- **浏览器 dev 模式自动播放策略**可能拦首次播放：测试按钮是用户手势路径不受影响；Tauri WKWebView 无此限制。
