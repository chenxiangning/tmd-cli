# 0.4.5 批次第二轮评审(攻击者视角)

> 日期:2026-10-26 · 状态:已收口(P2×3 当轮全修;P3 记档 2;核对不成立 3)
> 角度:换视角复审——不当实现者当攻击者,专打三类面:并发窗口(状态在操作等待期漂移)、边界跨域(两数据域交界重复/越界)、affordance 撒谎(UI 提示与实际行为不符)。对象 = 0.4.5 批次 12 笔提交(95a87d49..2613b946)。

## P2(当轮全修)

- **⌘F 跳转窗尾可越入活缓冲区 → 双喂重复渲染**(`terminalHistory.performJump`):窗尾 `min(offset+512KB, logSize)` 没钳 `earliestByte` —— 命中落在缓冲区前 512KB 内时(磁盘 raw 字节可见、xterm 缓冲文本不可见的形态,如 OSC 超链接 URL 内的命中),RIS + 页文本 + 缓冲快照把同一区段写两遍(与 0.2.x 手机活流双喂同缺陷类)。**修**:窗尾三重钳制(页预算 × 日志尾 × 缓冲起点);命中落在缓冲区内回空页不跳(缓冲搜索负责)。伴生语义:此前该形态下「跳转成功但内容重复」,现「跳转返回 false,findNext 在缓冲内再找一次」。
- **抽屉确认窗内 ask 迟到仍误写**(`useComposerDrawer`):ask 闸只查了点击时刻(确认弹窗**前**);确认等待期 CLI 进入 ask(常见:确认弹窗开着,上一轮输出到达触发 ask 面板)→ 用户点确认 → executeDrawerSend 照写,「/model」被当答案提交。注释自己写着「确认期间 ask 态可能变化,故在确认后重读」但只重读了广播闸(promptGate),ask 阻断没重读。**修**:executeDrawerSend 顶部 ask 复检,命中静默返回(不 toast 不写);重试时 UI 闸给出明示。
- **mobile 思考 chip title 撒谎**(`StatusBar.ThinkingChip`):引擎未声明思考命令(!sendable)时 title 仍说「点击打开思考强度选择」,点击 no-op——纯展示态却提示可点。**修**:title 仅 sendable 时给指引,否则 undefined。

## P3(记档,不动)

- **跳转 RIS 重写与 live 字节交错**:jumpToByte 的 term.write 链与并发到达的实时字节可能在重写窗内交错(活字节先到、缓冲快照后覆盖)——与既有 loadEarlier 同暴露类同写队列(xterm 串行解析保序,末段以缓冲快照为准),不新增风险面,维持现状。
- **stash drop 后 index 位移**:drop #0 后余项 index 整体前移;动作后 reload 列表 + busy 期全钮禁用已覆盖误操作窗,LRU/列表无陈旧 index 消费方。

## 核对不成立

- git_stash_* 未进 web dispatch(mobile 桥):stash 管理面是桌面 Git 面板特性,mobile 无调用方,不随 smart_checkout 路由是正确边界非缺口。
- blame.rs 每行 find_commit 性能:批前既有形态(本批只加 sha 字段未加查询),libgit2 对象缓存内,非本批回归。
- errText 切换行为等价:gitError 三测绿(委托后 isNotARepo/isAuth/display 全过),码提取对「E_GIT2: 任务调度失败: …」类复合串仍取纯码。

## 工具面

- 智能笔记 #23(main CI i18n ja 缺键红)经本会话多轮 check:gate 全绿证伪,已 dismiss(过时)。

## 验证

- `npx tsc --noEmit` 0 错;vitest composer+mobile+terminalSearchLog 46 文件 350 测全绿。
