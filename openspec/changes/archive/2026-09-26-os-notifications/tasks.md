# 任务分解:系统通知与额度撞墙预警

- [x] Rust:tauri-plugin-notification 依赖 + builder 注册 + capability `notification:default`
- [x] kernel/ipc.ts:`sendOsNotification` 薄包装(web 态恒 false,权限静默请求)
- [x] kernel/host:`isWindowFocused()` 公共读口
- [x] settings:notifyOsAsk / notifyOsTurnEnd / notifyOsSessionExit / notifyQuotaWarnPercent(类型/默认/清洗)
- [x] notify 插件:事件三边沿闸 + 额度轮询 + 设置分区 + en/ja 词典
- [x] 插件注册:index.ts 一行
- [x] 单测:notify.test.ts(12 断言)
- [ ] 真机目检(大仙):失焦 Ask/轮次结束/额度(阈值调 1)三路通知 + 权限拒绝路径
