/**
 * 增强引擎面契约:argv 组装(prompt 位置/模型旗标/空模型省略)、三档指令差异、
 * 围栏剥离、超时钳制、runEnhance 四态(成功剥围栏/超时/非零退出附 stderr/空结果)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const procCommunicate = vi.fn();
vi.mock("@kernel/ipc", () => ({ ipc: { procCommunicate: (spec: unknown) => procCommunicate(spec) } }));

beforeEach(() => procCommunicate.mockClear());

import {
  ENHANCE_ENGINES,
  buildEnhanceInstruction,
  clampTimeoutSeconds,
  runEnhance,
  stripCodeFence,
} from "./enhanceEngines";

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
    expect(ENHANCE_ENGINES[1].buildArgs(p, null)).toEqual(["exec", p]);
    expect(ENHANCE_ENGINES[4].buildArgs(p, null)).toEqual(["run", p]);
  });

  it("带模型:旗标按家分流(claude/omp/pi --model,其余 -m),codex 模型在 prompt 前", () => {
    const p = "改写我";
    expect(ENHANCE_ENGINES[0].buildArgs(p, "opus")).toEqual(["-p", p, "--model", "opus"]);
    expect(ENHANCE_ENGINES[1].buildArgs(p, "gpt-5")).toEqual(["exec", "-m", "gpt-5", p]);
    expect(ENHANCE_ENGINES[2].buildArgs(p, "x")).toEqual(["-p", "--model", "x", p]);
    expect(ENHANCE_ENGINES[5].buildArgs(p, "k3")).toEqual(["-p", "-m", "k3", p]);
  });

  it("模型串首尾空白视为空(用 CLI 默认)", () => {
    expect(ENHANCE_ENGINES[0].buildArgs("p", "  ")).toEqual(["-p", "p"]);
  });
});

describe("buildEnhanceInstruction", () => {
  const base = (text: string) => {
    expect(text).toContain("不要回答请求本身");
    expect(text).toContain("只输出改写后的提示词文本");
    expect(text.endsWith("草稿")).toBe(true);
  };

  it("三档档位行互异且都含草稿尾", () => {
    expect(buildEnhanceInstruction("d", "light")).toContain("只整理措辞与清晰度");
    expect(buildEnhanceInstruction("d", "structured")).toContain("简洁小节重组");
    expect(buildEnhanceInstruction("d", "executable")).toContain("最多输出 6 行短句");
    for (const p of ["light", "structured", "executable"] as const) base(buildEnhanceInstruction("草稿", p));
  });

  it("草稿原文完整保留在指令尾部", () => {
    const draft = "第一行\n第二行 with English";
    expect(buildEnhanceInstruction(draft, "light").endsWith(draft)).toBe(true);
  });
});

describe("stripCodeFence", () => {
  it("整段围栏剥内芯(含语言标注)", () => {
    expect(stripCodeFence("```text\n改写后\n多行\n```")).toBe("改写后\n多行");
    expect(stripCodeFence("```\nonly\n```")).toBe("only");
  });

  it("非全围栏形态原样返回", () => {
    expect(stripCodeFence("纯Oneliner")).toBe("纯Oneliner");
    expect(stripCodeFence("```ts\nconst a=1;\n```\n后面还有")).toBe("```ts\nconst a=1;\n```\n后面还有");
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

describe("runEnhance", () => {
  it("成功:组装指令走 procCommunicate,stdout 剥围栏返回", async () => {
    procCommunicate.mockResolvedValueOnce({ stdout: "```\n改写结果\n```", stderr: "", code: 0, timedOut: false });
    const out = await runEnhance({ engineId: "claude", draft: "原稿", preset: "light", model: null, cwd: "/repo", timeoutSeconds: 60 });
    expect(out).toEqual({ ok: true, text: "改写结果" });
    const spec = procCommunicate.mock.calls[0][0] as { command: string; args: string[]; cwd: string; closeStdin: boolean };
    expect(spec.command).toBe("claude");
    expect(spec.cwd).toBe("/repo");
    expect(spec.closeStdin).toBe(true);
    expect(spec.args[0]).toBe("-p");
    expect(spec.args[1]).toContain("用户草稿:\n原稿");
  });

  it("超时:kind=timeout", async () => {
    procCommunicate.mockResolvedValueOnce({ stdout: "", stderr: "", code: null, timedOut: true });
    const out = await runEnhance({ engineId: "codex", draft: "d", preset: "light", model: null, cwd: "/r", timeoutSeconds: 5 });
    expect(out).toEqual({ ok: false, kind: "timeout" });
  });

  it("非零退出:kind=engine 附 stderr 首 400 字", async () => {
    procCommunicate.mockResolvedValueOnce({ stdout: "", stderr: "boom\n", code: 1, timedOut: false });
    const out = await runEnhance({ engineId: "kimi", draft: "d", preset: "light", model: null, cwd: "/r", timeoutSeconds: 60 });
    expect(out).toEqual({ ok: false, kind: "engine", detail: "boom" });
  });

  it("空结果:kind=empty", async () => {
    procCommunicate.mockResolvedValueOnce({ stdout: "  \n", stderr: "", code: 0, timedOut: false });
    const out = await runEnhance({ engineId: "grok", draft: "d", preset: "light", model: null, cwd: "/r", timeoutSeconds: 60 });
    expect(out).toEqual({ ok: false, kind: "empty" });
  });

  it("未知引擎:engine 态,不 spawn", async () => {
    const out = await runEnhance({ engineId: "dsh", draft: "d", preset: "light", model: null, cwd: "/r", timeoutSeconds: 60 });
    expect(out).toEqual({ ok: false, kind: "engine", detail: "未知引擎 dsh" });
    expect(procCommunicate).not.toHaveBeenCalled();
  });
});
