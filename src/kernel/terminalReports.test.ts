/**
 * 终端协议回传分类契约 —— isProbeReply/shouldSuppressProbeReply 是 win 幕布
 * 探测应答与错位 CPR 拦截的判据:误吞 = 远端死等或用户击键丢失,漏放 =
 * TUI 输入框孤立字符复发,两头都钉。平台桩固定为 windows 走满分支。
 */

import { describe, expect, it, vi } from "vitest";
import { isProbeReply, isTerminalReport, shouldSuppressProbeReply } from "./terminalReports";

vi.mock("@kernel/platform", () => ({ getPlatformKind: () => "windows" }));

describe("isProbeReply", () => {
  it("DA/DA2/Kitty 探测应答命中(pi-tui 启动探测的真实回传形态)", () => {
    expect(isProbeReply("\x1b[?1;2c")).toBe(true); // DA1(xterm.js 应答)
    expect(isProbeReply("\x1b[>0;276;0c")).toBe(true); // DA2(xterm.js 应答)
    expect(isProbeReply("\x1b[0c")).toBe(true);
    expect(isProbeReply("\x1b[?0u")).toBe(true); // Kitty 键盘标志应答
  });

  it("CPR/DECRPM/OSC/DCS/焦点/鼠标不误中 —— 远端死等与协商类必须照放", () => {
    expect(isProbeReply("\x1b[1;1R")).toBe(false); // CPR:ssh wsl 启动死等(2026-09-11/09-12)
    expect(isProbeReply("\x1b[?2004;2$y")).toBe(false); // DECRPM:括号粘贴协商
    expect(isProbeReply("\x1b]11;rgb:0000/0000/0000\x07")).toBe(false); // OSC 背景色应答
    expect(isProbeReply("\x1bP>|xterm.js(5.5)\x1b\\")).toBe(false); // XTVERSION DCS 应答
    expect(isProbeReply("\x1b[I")).toBe(false); // 焦点进入
    expect(isProbeReply("\x1b[<0;1;1M")).toBe(false); // SGR 鼠标
  });

  it("用户击键不误吞:裸字符/光标键/组合键/Kitty 用户键/粘贴段", () => {
    expect(isProbeReply("c")).toBe(false);
    expect(isProbeReply("\x1b[A")).toBe(false); // 上光标
    expect(isProbeReply("\x1b[1;5C")).toBe(false); // Ctrl+Right(大写 C 终结)
    expect(isProbeReply("\x1b[97u")).toBe(false); // Kitty 用户按键无 ? 前缀
    expect(isProbeReply("\x1b[200~多行粘贴\x1b[201~")).toBe(false);
    expect(isProbeReply("普通输入")).toBe(false);
  });

  it("探测应答同时是整段终端回传 —— 与输入闸语义正交(窗内放行判定不变)", () => {
    for (const data of ["\x1b[?1;2c", "\x1b[>0;276;0c", "\x1b[?0u"]) {
      expect(isTerminalReport(data)).toBe(true);
    }
  });
});

describe("shouldSuppressProbeReply(win 平台桩)", () => {
  const stubHost = (profileId: string, cprMismatch?: boolean) => ({
    getSessions: () => [{ id: "s1", profileId }],
    getCliProfile: (id: string) => (id === profileId && cprMismatch ? { conptyCprMismatch: true } : undefined),
  });

  it("DA/Kitty 探测应答一律拦,与 CPR 错位声明无关(2026-09-10 孤立小写 c 类)", () => {
    expect(shouldSuppressProbeReply(stubHost("pi"), "s1", "\x1b[?1;2c")).toBe(true);
    expect(shouldSuppressProbeReply(stubHost("ssh", false), "s1", "\x1b[?1;2c")).toBe(true);
    expect(shouldSuppressProbeReply(stubHost("omp", true), "s1", "\x1b[?0u")).toBe(true);
  });

  it("CPR 仅在档案声明 conptyCprMismatch 时拦(omp/pi);其余会话照放(ssh/wsl 死等)", () => {
    expect(shouldSuppressProbeReply(stubHost("omp", true), "s1", "\x1b[1;1R")).toBe(true); // 2026-09-15 孤立大写 C 类
    expect(shouldSuppressProbeReply(stubHost("pi", true), "s1", "\x1b[26;120R")).toBe(true);
    expect(shouldSuppressProbeReply(stubHost("pi", true), "s1", "\x1b[?1;1R")).toBe(true); // DECXCPR 变体
    expect(shouldSuppressProbeReply(stubHost("ssh", false), "s1", "\x1b[1;1R")).toBe(false);
    expect(shouldSuppressProbeReply(stubHost("shell"), "s1", "\x1b[26;120R")).toBe(false);
  });

  it("焦点/鼠标/用户击键永不拦", () => {
    const omp = stubHost("omp", true);
    expect(shouldSuppressProbeReply(omp, "s1", "\x1b[I")).toBe(false);
    expect(shouldSuppressProbeReply(omp, "s1", "\x1b[O")).toBe(false);
    expect(shouldSuppressProbeReply(omp, "s1", "\x1b[<0;1;1M")).toBe(false);
    expect(shouldSuppressProbeReply(omp, "s1", "hello")).toBe(false);
  });
});
