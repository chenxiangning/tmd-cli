# anim 插件:tmd-anim 项目列表 + AI 会话一键拉起

日期:2026-10-14
状态:已实施(门禁全链 check:gate 绿;运行时目检由主会话负责)

## 背景与目标

tmd-anim(技术动画工具,独立仓库)的项目落盘在 `~/.tmd-anim/projects/<id>.json`(单文件项目,`{version:1, name, canvas?, scenes}`,形状见 tmd-anim `src/core/types.ts` 的 `Project`)。用户在 tmd-cli 里缺少两个入口:一是在 tmd-anim 应用中直接打开某个项目文件;二是针对某项目拉起 AI 会话做修改。

目标:

1. 新增 `src/plugins/anim/` 薄插件:中央 tab 列出全部动画项目(2s 轮询、容错「无效项目」);
2. 每行两个动作:「打开」(探测 tmd-anim 应用后 open-with)与「AI 会话」(确认窗 = 目标项目 link 卡片 + 可二次编辑的初始 prompt,确认才 spawn 默认引擎会话并写入;取消零副作用);
3. 零内核改动、零 Rust 改动;左 rail 一个入口;
4. 未安装引导:挂载即 `fsProbeOpenApp` 探测,缺席时列表顶常驻横幅(说明 + 「获取 tmd-anim」外链按钮,`openExternalUrl` 打开仓库页);点「打开」时仍复核探测。

## 方案取舍

**选定:spawn 走 `host.spawnRawSession`(按任意 spec spawn 并完整装配)。** spec 按任务约定拼装:`command/args/env` 取自默认引擎 profile(`resolveDefaultEngine` + `host.getCliProfile`,复用 workbench/defaultEngine,不另设猜测)、`cwd = ~/.tmd-anim/projects`(绝对路径)、`title = tmd-anim:<项目名>`。初始 prompt 经 `prepareSendPayload`(kernel 发送管线:translate + bracketedPaste + CR)后 `host.writeSession` 写入 —— 它是「用户输入唯一写入口」,对话锚定与 Ask 守望语义免费获得。

**否决:裸 `ipc.sessionSpawn` + `ipc.sessionWrite`。** 裸 spawn 只建 PTY 不进会话表,用户看不到会话(需要额外的 adopt 装配);裸 sessionWrite 绕过对话锚定,且 bracketedPaste 类 profile(pi-tui 系:kimi/pi)会整串吞字。host 面 API 就是为这种「插件拉起用户可见会话」场景准备的。

**否决:tmd-anim 深链。** v1 深链未实现(会落到主页)。「打开」动作探测成功即 `fsOpenWith(项目文件, app 目标)`,落到主页可接受,后续 tmd-anim 补深链时本插件零改动(协议是 open-with 目标)。

**容错口径:** 列表逐文件 `fsReadFile` + 最小解析(`parseAnimProject`:只验 version/name/scenes),解析失败行显示「无效项目」不崩;「AI 会话」点击时现读项目,文件已被删则回落建桩(新文件名 `p_anim_<base36 时间>_<短随机>.json`,内容为最小合法桩),解析失败(文件存在但坏)则提示先在 tmd-anim 修复 —— 桩绝不覆写已存在的坏文件,防误删用户手改内容。空态(目录不存在或无项目)给「AI 会话」按钮走建桩路径。

**轮询:** tab 为非 keepAlive,切走即卸载;2s `setInterval` 挂在组件 effect 内,卸载即清,busy 闸防上一轮未归并发堆叠(符合仓内「勿挂常驻轮询」文化,先例 checkpoints/BatchSheet 的组件级 interval)。

**AI 会话确认窗 + 卡片化管线(2026-10-14 四稿,用户拍板「提示词也不进输入框」):** 点击「AI 会话」先弹 `AiSessionDialog`(复用 kernel `DialogShell`/`DialogActions`):目标项目 link 卡片 + 引用卡片预览(协议 schema / 协议示例)+ 可编辑 prompt 正文(只含指令,路径不入编辑区)。「启动会话」= 桩落盘(若需)→ spawn 默认引擎会话(自动激活 tab)→ **初始提示词与引用全部挂该会话 composer 顶部卡片**(workbench 任务卡片同款:`refStore` 双桶按会话分 —— 提示词卡 + 引用清单;`chip.tsx` 贡献 `composer.attachments` 挂点),**输入框保持空置**;点提示词卡弹编辑弹层改全文(更新/丢弃),引用卡 ✕ 逐条移除。用户发送(空输入 = 仅发卡片,空输入 provider 放行):`animRefsSendTransform` 拼装「提示词前置 + 用户输入居中 + 引用清单块后置」并消费,失败 `undoAnimRefsSend` 回滚。不直写 PTY,CLI 仍只收文本路径(幕布零渲染铁则)。

**否决:直写 PTY 不确认。** 初始 prompt 含协议材料路径等长文本,用户无法事前审阅/裁剪;确认窗让「关联哪个项目、发什么内容」一眼可辨且可改。

## 验证

- `pnpm check:gate` 全链绿(file-size + arch-boundary + i18n 键比对 + typecheck + 3983 单测 + build);
- `tabContent.contract.test.ts` 的 `OPENABLE_KINDS` 镜像表同步新增 `anim.projects`(双向锁定);
- `animProjects.test.ts` 10 例 + `sessionRefs.test.ts` 5 例:解析容错、桩即合法项目、桩文件名格式、prompt 指令语义(路径不入正文)、卡片拼装/空输入/放行/undo/弃卡;
- i18n 三语键:`anim/locales.ts` en/ja 25 键全覆盖,缺键 0、不对称 0;
- 运行时交互(tauri:dev 真窗口目检)留主会话。
- 四稿运行时目检(2026-10-14,浏览器桩 1421 dev server):确认窗 →「启动会话」→ 零 PTY 写入、输入框空置、「初始提示词」卡 + 引用三卡并存;点提示词卡 → 编辑弹层改文「更新」生效;空输入回车发送 → wire = 编辑后提示词前置 + 引用块三路径后置、卡片整条消失、输入框仍空;`sessionRefs.test.ts` 5 例(拼装/空输入/放行/undo/弃卡)。
