## 1. 内核能力

- [x] 1.1 复制 codemoss 内置音效（success/chime/bell/ding.wav）到 `src/assets/sounds/`
- [x] 1.2 新建 `src/kernel/askSound.ts`：ANSI 剥离、跨 chunk 标记匹配、每轮去重、懒加载播放、`playAskSound` 试听入口
- [x] 1.3 `src/kernel/settings.ts` 新增 `askSoundEnabled`/`askSoundId` 字段 + 白名单清洗 + 默认值
- [x] 1.4 askSound 自驱接线：`bootAskSound`（main.tsx）订阅会话生命周期挂 `ipc.onPtyOutput` 观察者，host 零改动

- [x] 2.1 `BehaviorTab.tsx` 新增提示音行：segmented 开关 + 音效 select + 测试按钮

## 3. 测试与验证

- [x] 3.1 `askSound.test.ts`：标记命中/ANSI 混杂/跨分片/同轮去重/惰性轮次复位/生命周期清理/关闭静默/非法音效回落
- [x] 3.2 `settings.test.ts` 补充新字段清洗用例
- [x] 3.3 回归：`vitest` 418 全绿、`tsc --noEmit` 零错、`check:file-size`、`check:arch-boundary`
- [x] 3.4 冒烟：dev 行为页配置 + 测试按钮出声（ding/chime 均实播；真实 PTY Ask 触发链路由 3.1 单测覆盖，Tauri 壳内出声待用户真机确认）
