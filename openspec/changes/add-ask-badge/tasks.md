## 1. 内核能力

- [x] 1.1 新建 `src/kernel/askWatch.ts`:标记正则/ANSI 剥离/页脚窗口/240 字符尾巴
      (自 askSound 迁移)+ `AskWatch` 状态仓(置位/清除/尾巴重置/移除清理)
- [x] 1.2 `src/kernel/events.ts` 新增 `askDetected` topic(payload: sessionId)
- [x] 1.3 `src/kernel/host.ts` 组合:appendOutput 检测 + 事件广播、writeSession
      作答清除、removeSession 清理、`isWaitingConfirm` 只读(491 → 499 行,铁则内)
- [x] 1.4 `src/kernel/askSound.ts` 瘦身为播放管线 + askDetected 消费端
      (boot 幂等;设置门控/懒加载/白名单回落原样)

## 2. UI 呈现

- [x] 2.1 `SessionList.tsx` 活会话行 meta 区「等待确认」标签(waiting prop)
- [x] 2.2 `PinnedSessions.tsx` 全局置顶区的活绑定行同款标签
- [x] 2.3 `workspace-sessions.css` `.thread-ask-badge` 胶囊(锚定呼吸灯绿 soft 底)
- [x] 2.4 `main.tsx` bootAskSound 注释校准(检测上收后语义)

## 3. 测试与验证

- [x] 3.1 `askWatch.test.ts`:标记命中(omp/claude 页脚/y-n/Do you want)、跨分片、
      页脚窗口收敛、边沿去重、作答清除 + 尾巴重置防复燃、移除清理、host 接线
      (事件/isWaitingConfirm/写入清除/移除清理)
- [x] 3.2 `askSound.test.ts` 重写:事件接线、boot 幂等、关闭静默、非法音效回落、
      直呼播放(检测用例随迁 3.1)
- [x] 3.3 回归:`vitest` 59 文件 513 用例全绿、`tsc --noEmit` 零错、
      `check:file-size`、`check:arch-boundary`
- [x] 3.4 openspec 四件套(proposal/design/tasks/spec)
