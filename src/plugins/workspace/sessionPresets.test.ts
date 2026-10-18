/**
 * 会话预设存储单测(纯 node,DI 桩 ipc):坏文件回落空库、白名单 sanitize、
 * CRUD 撞名/回滚、消费文本解析(presetPromptText 三态)。
 * 模块级单例经 loadSessionPresets 复位(assets store.test 同手法)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { io } = vi.hoisted(() => ({
  io: { read: null as string | null, writes: [] as { path: string; content: string }[], failWrite: false },
}));

vi.mock("@kernel/ipc", () => ({
  ipc: {
    configHomeDir: async () => "/home",
    fsReadFile: async () => {
      if (io.read === null) throw new Error("missing");
      return io.read;
    },
    fsWriteFile: async (path: string, content: string) => {
      if (io.failWrite) throw new Error("denied");
      io.writes.push({ path, content });
    },
  },
}));

import {
  deletePreset,
  loadSessionPresets,
  presetPromptText,
  readSessionPresets,
  savePreset,
} from "./sessionPresets";

const PRESETS_PATH = "/home/.tmd-cli/session-presets.json";

async function reset(): Promise<void> {
  io.read = null;
  io.writes.length = 0;
  io.failWrite = false;
  await loadSessionPresets();
}

describe("sessionPresets 存储", () => {
  beforeEach(reset);

  it("缺文件/坏 JSON/非数组回落空库,loaded 置位", async () => {
    expect(readSessionPresets()).toEqual({ loaded: true, presets: [] });
    io.read = "{oops";
    await loadSessionPresets();
    expect(readSessionPresets()).toEqual({ loaded: true, presets: [] });
    io.read = JSON.stringify({ version: 1, presets: "nope" });
    await loadSessionPresets();
    expect(readSessionPresets()).toEqual({ loaded: true, presets: [] });
  });

  it("sanitize 白名单:坏形条目/prompt 坏形整条弃置,空白 model 弃置", async () => {
    io.read = JSON.stringify({
      version: 1,
      presets: [
        { id: "a", name: "空文本", engineId: "claude", model: "  ", prompt: { text: "  " } },
        { id: "b", name: "引用库", engineId: "omp", prompt: { ref: { scope: "global", name: "review" } } },
        { id: "c", name: "坏引用", engineId: "omp", prompt: { ref: { scope: "weird", name: "x" } } },
        { id: "d", name: "无提示词", engineId: "kimi" },
        { name: "无 id" },
        null,
      ],
    });
    await loadSessionPresets();
    const presets = readSessionPresets().presets;
    /* a/c 的 prompt 字段坏形 → 整条弃置(不留语义漂移的无提示词预设);d 合法。 */
    expect(presets.map((p) => p.id)).toEqual(["b", "d"]);
    expect(presets[0]).toMatchObject({ id: "b", prompt: { ref: { scope: "global", name: "review" } } });
    expect(presets[1]).toMatchObject({ id: "d", prompt: undefined });
  });

  it("savePreset 新建自产 id 落盘;空名/撞名(大小写不敏感)拒绝", async () => {
    const a = await savePreset({ name: "审阅", engineId: "claude" });
    expect(a?.id).toMatch(/^preset-/);
    expect(io.writes).toEqual([{ path: PRESETS_PATH, content: expect.stringContaining("\"presets\"") }]);
    expect(await savePreset({ name: "", engineId: "claude" })).toBeNull();
    expect(await savePreset({ name: "审阅", engineId: "omp" })).toBeNull();
    expect(await savePreset({ name: " 审阅 ", engineId: "omp" })).toBeNull();
  });

  it("savePreset 编辑按 id 原位替换;写盘失败回滚内存并返回 null", async () => {
    const a = await savePreset({ name: "A", engineId: "claude" });
    await savePreset({ name: "B", engineId: "omp" });
    io.failWrite = true;
    expect(await savePreset({ id: a!.id, name: "A2", engineId: "kimi" })).toBeNull();
    expect(readSessionPresets().presets.map((p) => p.name)).toEqual(["A", "B"]);
    io.failWrite = false;
    const a2 = await savePreset({ id: a!.id, name: "A2", engineId: "kimi" });
    expect(a2).toMatchObject({ name: "A2", engineId: "kimi" });
    expect(readSessionPresets().presets.map((p) => p.name)).toEqual(["A2", "B"]);
  });

  it("deletePreset 删除落盘;未命中幂等成功;写盘失败回滚返回 false", async () => {
    const a = await savePreset({ name: "A", engineId: "claude" });
    expect(await deletePreset("nope")).toBe(true);
    io.failWrite = true;
    expect(await deletePreset(a!.id)).toBe(false);
    expect(readSessionPresets().presets).toHaveLength(1);
    io.failWrite = false;
    expect(await deletePreset(a!.id)).toBe(true);
    expect(readSessionPresets().presets).toHaveLength(0);
    expect(JSON.parse(io.writes.at(-1)!.content).presets).toEqual([]);
  });

  it("presetPromptText:无提示词 = 空串;内联 = 原文;引用 = contentOf 现读", () => {
    expect(presetPromptText({ id: "p", name: "n", engineId: "e" }, () => "x")).toBe("");
    expect(
      presetPromptText({ id: "p", name: "n", engineId: "e", prompt: { text: "全文" } }, () => "x"),
    ).toBe("全文");
    expect(
      presetPromptText(
        { id: "p", name: "n", engineId: "e", prompt: { ref: { scope: "global", name: "review" } } },
        (name) => `正文:${name}`,
      ),
    ).toBe("正文:review");
  });
});
