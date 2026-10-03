# 手机对话输入区三态重做提交后评审(交互/边界/架构)

- 日期:2026-10-03
- 状态:已完成(实锤 2 全修;疑似 4 择要留观;门禁全绿随提交收口)
- 范围:9b9a9ee0(三态胶囊 composer 重做,11 文件 +449/-251);主会话只读复审 + 修复
- 性质:评审记录,修复并入本轮提交

## 结论先行

行为契约面核验通过:Enter/IME 守卫原样迁移、发送失败保草稿 + 错误条重试链路完整、objectURL 释放归 useShots、键条 hidden 条件(kbOpen || !kbOn)与 DOM 位置不变、暗色走令牌。实锤 2:一处在**交互数据安全**——chip 填稿直接覆盖已输入草稿(静默丢字);一处在**注释失实**(「2 行起步」与单行起步的实现不符)。全部修复;无回归级误报。

## 实锤与修复

| # | 发现 | 修复 |
|---|---|---|
| 1 | 挂图后点提示 chip 直接覆盖草稿:用户已打的文字被静默清掉(useDraft 只存最新值,覆盖即不可恢复) | `composerChips.ts` 新增纯函数 `joinPrompt`:空稿直填、非空稿换行追加;chip 点击走追加;`/model` 保持替换(命令语义,追加会破坏命令);补 3 断言单测 |
| 2 | Composer autosize 注释「随内容 2 行起步」失实(rows=1,CSS min-height 34px = 单行起步) | 注释改「单行起步、132px 封顶」 |

## 核验通过(不改动)

- Enter 裸键=换行 / ⌘+Ctrl+Enter=发送 / IME 组合不拦截(mobileEnterAction 原样,含 keyCode 口径);
- 发送契约:composeSendText 空稿+图同权、成功才清草稿挂图、失败保草稿 + 悬浮错误条重试 + 续输清错;
- 键条:软键盘弹起整行隐藏、pref 持久化(tmd.keybar.on)、session_write 通道零新 RPC;
- 挂图生命周期:objectURL 随移除/发送/卸载释放(useShots 原样),「再加一张」与相机钮共用 onShot 忙态闸;
- 样式落点:mobile.css 仅剩指针注释 + keybar + 全屏看图;`.send`/`.kb-toggle`/`.grabber` 零残留引用;`cp-` 前缀无碰撞;mobile-dark.css 错误条覆盖类名未变仍生效;
- 架构:mobile 树零 `@shell`/插件 UI import,300 行铁则最大 242 行,i18n 三语新键补齐(缺键 0)。

## 疑似与留观(不修,含理由)

- 挂图态「+」被发送蓝圆顶替,面板不可达:参考图同款形制,清空即达;spec 方案取舍已记录;
- 切模型填稿聚焦后软键盘弹起压住键条:与手动输入 `/model` 同流程(键条契约=聚焦隐藏),收键盘即见;
- 外接键盘 ⌘+Enter 发送成功清图后面板若仍展开则保持展开:无害态,再点 ✕ 即收;
- 选图进行中相机钮仅降透明度(旧版有「…」文案):native picker 弹起本身即反馈,真机目检复核;
- Composer 未 memo,SessionScreen 2.5s ask 轮询重渲等价旧版(composer JSX 本就在父 render 内)——误报摘录,防重查。

## 验证

typecheck 0 错;test 454 文件/3523 例全绿(含 Composer 6 例);arch-boundary/file-size/i18n-keys/build 全过;react-doctor 100/100;无头 Chrome 引真实 CSS 三态渲染目检通过(临时页,不进仓库)。真机(iOS 壳)目检项留大仙:软键盘弹起收面板、键条显隐、相册→chips→追加填稿→发送整链、纯图发送。
