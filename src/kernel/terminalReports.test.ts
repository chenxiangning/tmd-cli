/**
 * 终端协议回传识别契约(用例即协议清单)。
 *
 * 回传侧:焦点/鼠标/查询应答必须整段识别 —— 否则点一下终端/滚一轮就被
 * 当成用户首写,无对话历史会话点亮呼吸灯(activityWatch 首写闸失效)。
 * 击键侧:SS3/CSI 箭头、Kitty 协议按键(无 ? 的 CSI 数字u)、括号粘贴、
 * 裸 ESC 与 alt 组合键绝不可吞 —— 宁可漏判回传,不可吞真实击键。
 * 混合段(击键夹回传)按用户输入放行:xterm 按输入事件逐次触发 onData,
 * 整段回传是常态,混合段按用户处理只损失一次"不锚定",无副作用。
 */
import { describe, expect, it } from "vitest";
import { isTerminalReport } from "./terminalReports";

describe("isTerminalReport:回传侧(照写 PTY,不锚定对话)", () => {
  it.each([
    ["\x1b[I", "焦点进入(DECSET 1004)"],
    ["\x1b[O", "焦点离开"],
    ["\x1b[<0;10;5M", "SGR 鼠标按下"],
    ["\x1b[<0;10;5m", "SGR 鼠标抬起"],
    ["\x1b[32;10;5M", "urxvt 鼠标"],
    ["\x1b[M !!", "X10 鼠标(M + 3 字节坐标)"],
    ["\x1b[12;34R", "CPR 光标应答(无 ?)"],
    ["\x1b[?12;34;5R", "DECXCPR 应答"],
    ["\x1b[?64;1;2;6;9c", "DA1 应答"],
    ["\x1b[>0;277;0c", "DA2 应答"],
    ["\x1b[?1u", "Kitty 协议标志应答(带 ?)"],
    ["\x1b[0n", "状态报告"],
    ["\x1b[?1002;1$y", "DECRPM 模式报告"],
    ["\x1b]11;rgb:1c1c/1c1c/1c1c\x1b\\", "OSC 颜色应答(ST 结尾)"],
    ["\x1b]10;rgb:0/0/0\x07", "OSC 颜色应答(BEL 结尾)"],
    ["\x1bP>|xterm(370)\x1b\\", "XTVERSION 应答"],
    ["\x1bP1$r0;1;1t\x1b\\", "DECRQSS 应答"],
  ])("%s —— %s", (data) => {
    expect(isTerminalReport(data)).toBe(true);
  });
});

describe("isTerminalReport:击键侧(必须放行,不可吞)", () => {
  it.each([
    ["\x1bOA", "SS3 上箭头(无 CSI 中括号,不与焦点上报混淆)"],
    ["\x1b[A", "CSI 上箭头"],
    ["\x1b[13u", "Kitty 协议回车键(无 ? —— 与标志应答的区分线)"],
    ["\x1b[97;5u", "Kitty 协议 ctrl+a"],
    ["\x1b[200~past\x1b[201~", "括号粘贴 = 用户输入"],
    ["hi\r", "普通输入"],
    ["\r", "回车"],
    ["a", "单字符"],
    ["\x1b", "裸 ESC"],
    ["\x1bn", "alt+n"],
    ["\x1bP", "alt+shift+p"],
    ["hi\x1b[I", "混合段(击键夹回传)按用户输入放行"],
  ])("%s —— %s", (data) => {
    expect(isTerminalReport(data)).toBe(false);
  });
});
