/**
 * 增强引擎面契约(v2 PTY 流式):argv 组装、哨兵指令、ANSI/PTY 清洗、哨兵提取、
 * runEnhance 全链路(spawn → 流式回调 → 日志终稿 → 杀会话 → 磁盘身份归档)、
 * 超时杀、command not found、空结果、未知引擎不 spawn。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ipcMocks = vi.hoisted(() => ({
  sessionSpawn: vi.fn(),
  sessionKill: vi.fn(async () => undefined),
  sessionLogSize: vi.fn(async () => 0),
  sessionHistoryPage: vi.fn(async () => ({ text: "", startOffset: 0, hasMore: false })),
  onPtyOutput: vi.fn(),
  onPtyExit: vi.fn(),
}));
vi.mock("@kernel/ipc", () => ({
  ipc: {
    sessionSpawn: (...a: unknown[]) => ipcMocks.sessionSpawn(...(a as [string, unknown, string?])),
    sessionKill: ipcMocks.sessionKill,
    sessionLogSize: ipcMocks.sessionLogSize,
    sessionHistoryPage: ipcMocks.sessionHistoryPage,
  },
  onPtyOutput: ipcMocks.onPtyOutput,
  onPtyExit: ipcMocks.onPtyExit,
}));
const hostMocks = vi.hoisted(() => ({ getCliProfile: vi.fn() }));
vi.mock("@kernel/host", () => ({ host: { getCliProfile: hostMocks.getCliProfile } }));
const archiveMocks = vi.hoisted(() => ({ archiveSession: vi.fn() }));
vi.mock("@kernel/sessionArchive", () => ({
  archiveSession: archiveMocks.archiveSession,
  sessionArchiveKey: (w: string, p: string, c: string) => `${w}:${p}:${c}`,
}));

import {
  ENHANCE_ENGINES,
  buildEnhanceInstruction,
  clampTimeoutSeconds,
  extractEnhanced,
  normalizePtyText,
  runEnhance,
} from "./enhanceEngines";
/* kernel 契约的消费方回归钉:OSC8(ST 终止)之间的正文必须存活 —— 增强链路
   的 ANSI 清洗已收敛到 kernel askDetect.stripAnsi,此处钉防其回归。 */
import { stripAnsi } from "@kernel/askDetect";

const outCbs = new Map<string, (text: string) => void>();
const exitCbs = new Map<string, () => void>();

beforeEach(() => {
  outCbs.clear();
  exitCbs.clear();
  ipcMocks.sessionSpawn.mockReset().mockResolvedValue({ id: "pty-9", pid: 7 });
  ipcMocks.sessionKill.mockClear();
  ipcMocks.sessionLogSize.mockResolvedValue(100);
  ipcMocks.sessionHistoryPage.mockResolvedValue({ text: "", startOffset: 0, hasMore: false });
  ipcMocks.onPtyOutput.mockReset().mockImplementation(async (id: string, cb: (t: string) => void) => {
    outCbs.set(id, cb);
    return () => outCbs.delete(id);
  });
  ipcMocks.onPtyExit.mockReset().mockImplementation(async (id: string, cb: () => void) => {
    exitCbs.set(id, cb);
    return () => exitCbs.delete(id);
  });
  hostMocks.getCliProfile.mockReset().mockReturnValue(undefined);
  archiveMocks.archiveSession.mockClear();
});

const BASE = {
  draft: "原稿",
  preset: "light" as const,
  model: null,
  cwd: "/repo",
  workspaceId: "ws1",
  timeoutSeconds: 60,
  onChunk: vi.fn(),
};

describe("ENHANCE_ENGINES argv 组装", () => {
  it("8 家引擎齐备,command 与 profile id 同名", () => {
    expect(ENHANCE_ENGINES.map((e) => e.id)).toEqual([
      "claude", "codex", "omp", "pi", "opencode", "kimi", "qoder", "grok",
    ]);
    for (const e of ENHANCE_ENGINES) expect(e.command).toBe(e.id);
  });

  it("空模型:不出现模型旗标,prompt 落位各家惯用位置", () => {
    const p = "改写我";
    expect(ENHANCE_ENGINES[0].buildArgs(p, null)).toEqual(["-p", p]);
    expect(ENHANCE_ENGINES[1].buildArgs(p, null)).toEqual(["exec", "--skip-git-repo-check", p]);
    expect(ENHANCE_ENGINES[4].buildArgs(p, null)).toEqual(["run", p]);
  });

  it("带模型:旗标按家分流(claude/omp/pi --model,其余 -m)", () => {
    const p = "改写我";
    expect(ENHANCE_ENGINES[0].buildArgs(p, "opus")).toEqual(["-p", p, "--model", "opus"]);
    expect(ENHANCE_ENGINES[1].buildArgs(p, "gpt-5")).toEqual(["exec", "--skip-git-repo-check", "-m", "gpt-5", p]);
    expect(ENHANCE_ENGINES[5].buildArgs(p, "k3")).toEqual(["-p", "-m", "k3", p]);
  });

  it("grok:-p 是 --single 取值型,prompt 必须紧跟其后(--help 实证回归钉)", () => {
    expect(ENHANCE_ENGINES[7].buildArgs("改写我", null)).toEqual(["--single", "改写我"]);
    expect(ENHANCE_ENGINES[7].buildArgs("改写我", "grok-4")).toEqual(["--single", "改写我", "-m", "grok-4"]);
  });

  it("模型串首尾空白视为空(用 CLI 默认)", () => {
    expect(ENHANCE_ENGINES[0].buildArgs("p", "  ")).toEqual(["-p", "p"]);
  });
});

describe("buildEnhanceInstruction", () => {
  it("含哨兵规则与档位行,草稿原文完整保留在指令尾部", () => {
    for (const preset of ["light", "structured", "executable"] as const) {
      const text = buildEnhanceInstruction("草稿", preset);
      expect(text).toContain("<ENHANCED>");
      expect(text).toContain("不要回答请求本身");
      expect(text.endsWith("草稿")).toBe(true);
    }
    expect(buildEnhanceInstruction("d", "light")).toContain("只整理措辞与清晰度");
    expect(buildEnhanceInstruction("d", "structured")).toContain("简洁小节重组");
    expect(buildEnhanceInstruction("d", "executable")).toContain("最多输出 6 行短句");
  });
});

describe("PTY 清洗与哨兵提取", () => {
  it("stripAnsi 剥 OSC/CSI,保留正文与换行(裸控制符归 normalizePtyText)", () => {
    expect(stripAnsi("\x1b]0;title\x07OK\x1b[31m红\x1b[0m\n")).toBe("OK红\n");
    expect(normalizePtyText("a\x08b\x7fc")).toBe("abc");
  });

  it("OSC8 链接(ST 终止)之间的正文存活(贪婪吞正文回归钉)", () => {
    const s = "a\x1b]8;;http://x\x1b\\点击\x1b]8;;\x1b\\b";
    expect(stripAnsi(s)).toBe("a点击b");
  });

  it("normalizePtyText 归一 CRLF/裸 CR 并压空行", () => {
    expect(normalizePtyText("Working...\r\n\r\n\r\nOK\r\n")).toBe("Working...\n\nOK");
  });

  it("哨兵内芯优先:前后进度行/插件噪声/转义全隔离", () => {
    const log = "\x1b[2mWorking...\r\n\x1b[0m<ENHANCED>修复报错:先复现\r\n再修</ENHANCED>\r\nExtension error (x): noise";
    expect(extractEnhanced(log)).toBe("修复报错:先复现\n再修");
  });

  it("哨兵内芯整段围栏剥壳;哨兵缺失回退全量清洗", () => {
    expect(extractEnhanced("```text\n<ENHANCED>答案</ENHANCED>\n```")).toBe("答案");
    expect(extractEnhanced("Working...\n无哨兵的答案")).toBe("Working...\n无哨兵的答案");
  });
});

describe("clampTimeoutSeconds", () => {
  it("NaN 回 60,越界钳到 5..300,四舍五入", () => {
    expect(clampTimeoutSeconds(NaN)).toBe(60);
    expect(clampTimeoutSeconds(0)).toBe(5);
    expect(clampTimeoutSeconds(9999)).toBe(300);
    expect(clampTimeoutSeconds(60.4)).toBe(60);
  });
});

describe("runEnhance 全链路", () => {
  const fullLog = (text: string) => {
    ipcMocks.sessionLogSize.mockResolvedValue(text.length);
    ipcMocks.sessionHistoryPage.mockResolvedValue({ text, startOffset: 0, hasMore: false });
  };

  it("spawn 带 argv spec;终稿取哨兵;流式回调给清洗文本;杀会话+归档身份", async () => {
    fullLog("Working...\n<ENHANCED>终稿</ENHANCED>\nnoise");
    hostMocks.getCliProfile.mockReturnValue({
      listSessions: async () => [{ id: "disk-1", modifiedAt: Date.now() + 9_000, path: "/x" }],
    });
    const pending = runEnhance({ ...BASE, engineId: "omp", onChunk: BASE.onChunk });
    await vi.waitFor(() => expect(outCbs.has("pty-9")).toBe(true));
    outCbs.get("pty-9")!("\x1b[2mWorking...\r\n");
    outCbs.get("pty-9")!("<ENHANCED>终");
    outCbs.get("pty-9")!("稿</ENHANCED>");
    expect(BASE.onChunk).toHaveBeenLastCalledWith(expect.stringContaining("Working..."));
    exitCbs.get("pty-9")!();
    const out = await pending;
    expect(out).toEqual({ ok: true, text: "终稿" });
    expect(ipcMocks.sessionSpawn).toHaveBeenCalledWith(
      "omp",
      expect.objectContaining({ command: "omp", cwd: "/repo" }),
      "ws1",
    );
    expect(String(ipcMocks.sessionSpawn.mock.calls[0][1].args[1])).toContain("用户草稿:\n原稿");
    await vi.waitFor(() => expect(ipcMocks.sessionKill).toHaveBeenCalledWith("pty-9"));
    await vi.waitFor(() => expect(archiveMocks.archiveSession).toHaveBeenCalledWith("ws1:omp:disk-1"));
  });

  it("流为权威:exit 后日志已死(sessionLogSize=0)仍从流取终稿(空结果回归钉)", async () => {
    ipcMocks.sessionLogSize.mockResolvedValue(0);
    ipcMocks.sessionHistoryPage.mockResolvedValue({ text: "", startOffset: 0, hasMore: false });
    const pending = runEnhance({ ...BASE, engineId: "omp" });
    await vi.waitFor(() => expect(outCbs.has("pty-9")).toBe(true));
    outCbs.get("pty-9")!("Working...\r\n<ENHANCED>流终稿</ENHANCED>");
    exitCbs.get("pty-9")!();
    expect(await pending).toEqual({ ok: true, text: "流终稿" });
  });

  it("流为空退日志兜底:日志哨兵提取成功", async () => {
    fullLog("<ENHANCED>日志终稿</ENHANCED>");
    const pending = runEnhance({ ...BASE, engineId: "kimi" });
    await vi.waitFor(() => expect(exitCbs.has("pty-9")).toBe(true));
    exitCbs.get("pty-9")!();
    expect(await pending).toEqual({ ok: true, text: "日志终稿" });
  });

  it("command not found → engine 态附该行", async () => {
    fullLog("zsh: command not found: grok\n");
    const pending = runEnhance({ ...BASE, engineId: "grok" });
    await vi.waitFor(() => expect(exitCbs.has("pty-9")).toBe(true));
    exitCbs.get("pty-9")!();
    const out = await pending;
    expect(out).toEqual({ ok: false, kind: "engine", detail: "zsh: command not found: grok" });
  });

  it("空日志 → empty;spawn 抛错 → engine 态不炸", async () => {
    const p1 = runEnhance({ ...BASE, engineId: "pi" });
    await vi.waitFor(() => expect(exitCbs.has("pty-9")).toBe(true));
    exitCbs.get("pty-9")!();
    expect(await p1).toEqual({ ok: false, kind: "empty" });

    ipcMocks.sessionSpawn.mockReset().mockRejectedValue("boom");
    expect(await runEnhance({ ...BASE, engineId: "pi" })).toEqual({ ok: false, kind: "engine", detail: "boom" });
  });

  it("未知引擎:engine 态,不 spawn", async () => {
    expect(await runEnhance({ ...BASE, engineId: "dsh" })).toEqual({
      ok: false,
      kind: "engine",
      detail: "未知引擎 dsh",
    });
    expect(ipcMocks.sessionSpawn).not.toHaveBeenCalled();
  });

  it("超时:定时杀会话,exit 后判 timeout", async () => {
    vi.useFakeTimers();
    try {
      ipcMocks.sessionLogSize.mockResolvedValue(12);
      ipcMocks.sessionHistoryPage.mockResolvedValue({ text: "半截输出", startOffset: 0, hasMore: false });
      const pending = runEnhance({ ...BASE, engineId: "omp", timeoutSeconds: 5 });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(ipcMocks.sessionKill).toHaveBeenCalledWith("pty-9");
      exitCbs.get("pty-9")!();
      await vi.advanceTimersByTimeAsync(800);
      expect(await pending).toEqual({ ok: false, kind: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });
});
