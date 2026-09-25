# 审批收件箱任务分解

- [x] 1.1 `src/plugins/approval-inbox/store.ts`:等待快照 store(createSubscribable;getSessions×isWaitingConfirm 重算、since 表、摘录缓存与拉取、answer 通道)
- [x] 1.2 `store.ts` 事件接线:askDetected(since+摘录)/turnSettled/sessionsChanged/sessionExited 重算;`excerptFromTail` 纯函数
- [x] 1.3 `src/plugins/approval-inbox/panel.tsx`:摘要行 + 行列表(引擎图标/标题链/时长/摘录)+ 直达 + 应答输入
- [x] 1.4 `index.tsx` 注册面(registerFilePanel,showFileSubbar:false)+ `allPlugins` 一行;locales 三件(en/ja/注册)
- [x] 1.5 `store.test.ts`:摘录纯函数、since 不重置、answer 载荷与行消退、边沿重算(mock host/ipc;10 用例)
- [x] 2.1 门禁五件套 + react-doctor 100(typecheck/2861 测试/R1R3R4/300 行/build 全绿)
- [x] 2.2 浏览器桩目检(1421 桩:ask 帧注入→行上屏+摘录+时长;应答 y → session_write "y\n" 载荷 + 行消退 + 空态;直达重激活)
- [ ] 2.3 真机目检(大仙)
- [x] 2.4 文档收口(docs/README.md 索引 + 原型注记 A2 纪律)
