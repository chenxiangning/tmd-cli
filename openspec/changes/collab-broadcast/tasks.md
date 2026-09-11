# 任务分解:横评广播

前置已完成:spec 评审通过(2026-09-11 大仙指令「整利索到可执行状态」= 三个拍板点认可:上限 4 路 / 分屏态 composer 隐藏打字直进焦点列 / dsh 不参与)。索引状态已翻(c74f89d)。

## 1. kernel:broadcast store + 草稿桥

- [ ] 1.1 `src/kernel/broadcast.ts`:`{ ids, focusId }` createSubscribable store,API = `openBroadcast(ids)/closeBroadcast()/setFocus(id)/removeColumn(id)/toggleOrCycleFocus()`;空 ids 即非分屏;focusId 悬挂回落首列;旁挂 `composerDraftRef`(get/clear 闭包交接,composerSendRef 同构)
- [ ] 1.2 `src/kernel/plugin.ts`:MountPoint 联合加 `"editorCenter.broadcast"`
- [ ] 1.3 `src/kernel/broadcast.test.ts`:空集语义、removeColumn 剪空自动 close、focus 悬挂回落

## 2. 插件:入口 + 弹层

- [ ] 2.1 `src/plugins/collab-broadcast/index.tsx`:Plugin 壳,activate(ctx) 注册 inputRail 按钮贡献 + `editorCenter.broadcast` 分屏挂载;`plugins/index.ts` allPlugins 一行
- [ ] 2.2 `EnginePicker.tsx`:多选弹层(portal;候选 getCliProfiles + 就绪探针;当前 profile 预选;≥2 才可发;上限 4 提示;singleInstance/未安装置灰标注;Escape/backdrop 关闭)
- [ ] 2.3 `broadcast.ts`(插件内编排):从 composerDraftRef 取题面 → 逐路并行 `host.createSession`(并发安全=spawn 在途闸)→ 各路 `prepareSendPayload` + `writeSession` → `openBroadcast(ids)` → 清草稿 + `recordPrompt` 一次;失败路剔除、全败不进分屏不清草稿;singleInstance 命中既有会话 → toast「题面未广播」
- [ ] 2.4 Composer.tsx 挂载期交接 composerDraftRef(约 3 行)

## 3. 插件:分屏组件

- [ ] 3.1 `SplitView.tsx`:水平 PanelGroup,N 列 = 列头 + 真 `TerminalView`(active 恒 true);等分可拖;列头 = 引擎字形 + 名 + 状态点(ask/呼吸灯数据复用)+ 耗时 + ✕
- [ ] 3.2 键盘:`⌥←/→` 切焦点列、`⌥W` 退屏;焦点列 `box-shadow: inset 0 0 0 2px` 标记;列头外增强不触幕布(PTY 铁律)
- [ ] 3.3 会话消失订阅:`kernel.sessions.changed` → 剪已不在活表的列;剪空 close
- [ ] 3.4 MainPanel canvas Panel 分支:分屏态渲染 `Mounts("editorCenter.broadcast")` 替代 kept-map;列组件文件独立(鱼骨态④复用约定)
- [ ] 3.5 CSS 独立文件(列头/焦点/退屏浮签),token 全走 `--tmd-*`

## 4. 验证

- [ ] 4.1 单测:store 语义 + 编排循环 mock 断言(每路 prepareSendPayload/writeSession 各一次、recordPrompt 恰一次、失败路剔除)
- [ ] 4.2 桩目检(1421 + Tauri 桩配方):假 profile ×3 全旅程 = 选引擎→三列渲染→⌥←→ 焦点→关列→退屏;一路 spawn 失败 = toast + 两列存活;外部 kill 列 = 死态红点
- [ ] 4.3 真机 tauri:dev:claude+omp+codex 三路真广播目检自动提交与首答
- [ ] 4.4 门禁五件套全绿

## 5. 收口

- [ ] 5.1 docs/README spec 条目状态 →「已落地」;结论沉淀 `docs/architecture/`(广播态契约,编号递增)
- [ ] 5.2 提交:`feat(collab): 横评广播…`(显式文件清单,核对 git status 不扫他人 in-flight)
