## Why

tmd-cli 托管的 CLI 会话（omp/claude 等）弹出 Ask 提问、权限确认等阻塞面板时只有视觉提示，用户离开屏幕后任务静默阻塞无人知晓（高频场景：PlanFirst 确认闸门、工具授权）。需要声音提醒，并可在设置页「行为」tab 配置。

## What Changes
- 每轮对话最多播放一次：轮次边界取「输出静默 >2s」，与 kernel/host 活动守望同阈值（实现为检测模块内惰性判定，host 零改动），TUI 重绘不重复打扰
- 新增 Ask 提示音能力：检测 PTY 输出中"CLI 阻塞等待用户确认"的界面标记（omp Ask 面板、claude 确认页脚、通用 y/n 提问），命中时播放提示音
- 设置页「行为」tab 新增两个配置行：提示音开关（默认开启）+ 音效选择（默认/风铃/铃声/叮咚）+ 测试按钮
- 内置 4 个 wav 音效资产（懒加载，不进主 chunk）
- 设置存储新增 `askSoundEnabled` / `askSoundId` 字段，sanitize 白名单兜底，旧配置文件双向兼容

## Capabilities

### New Capabilities

- `ask-notification-sound`: Ask/确认面板出现时的声音提醒，及其在设置页行为 tab 的开关、音效选择与试听配置

### Modified Capabilities

（无 —— 现有设置、会话、终端能力的需求均不变）

## Impact

- 新增：`src/kernel/askSound.ts`（检测 + 播放）、`src/assets/sounds/*.wav`
- 修改：`src/kernel/host.ts`（appendOutput 检测接线 / 轮次结算重置 / removeSession 清理）、`src/kernel/settings.ts`（两个新字段 + 清洗）、`src/plugins/settings/BehaviorTab.tsx`（设置 UI）

> **落地修订(2026-09-02)**:最终实现为 host 零改动 —— 检测逻辑独立在 `src/kernel/askSound.ts`
> 纯监听模块,`main.tsx` 启动时 `bootAskSound()` 挂载;settings 字段与 BehaviorTab 如期落地。
- 架构边界不破坏：新模块不 import `@tauri-apps/*`（R3）、kernel 不 import plugins（R1）
- 不做自定义音频文件（`convertFileSrc` 需为 R3 开专门通道，本次 YAGNI）
