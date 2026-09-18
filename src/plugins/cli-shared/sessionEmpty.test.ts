/**
 * jsonl 会话判空共享库契约(会话卫生清扫的物理删除依据)。
 * 核心不变量:误判方向恒为「少删」—— 标记子串命中/读取失败/异型返回一律非空。
 */
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fsReadHead: vi.fn(),
}));
vi.mock("@kernel/ipc", () => ({ ipc: { fsReadHead: mocks.fsReadHead } }));

import { isJsonlSessionEmpty } from "./sessionEmpty";

const PATH = "/repo/.omp/x.jsonl";

describe("isJsonlSessionEmpty", () => {
  it("头部无用户消息标记(omp 出生文件实证形态)= 空", async () => {
    mocks.fsReadHead.mockResolvedValue('{"type":"custom","custom":true}\n');
    expect(await isJsonlSessionEmpty(PATH)).toBe(true);
  });

  it("claude 实证空会话形态(cost-state/mode 行)= 空", async () => {
    mocks.fsReadHead.mockResolvedValue(
      '{"type":"cost-state","cost":0}\n{"type":"mode","mode":"normal"}\n',
    );
    expect(await isJsonlSessionEmpty(PATH)).toBe(true);
  });

  it("omp/pi 用户消息行(role:user)= 非空", async () => {
    mocks.fsReadHead.mockResolvedValue(
      '{"type":"message","message":{"role":"user","content":"hi"}}\n',
    );
    expect(await isJsonlSessionEmpty(PATH)).toBe(false);
  });

  it("claude/qoder 行型(type:user)= 非空", async () => {
    mocks.fsReadHead.mockResolvedValue('{"type":"user","uuid":"u"}\n');
    expect(await isJsonlSessionEmpty(PATH)).toBe(false);
  });

  it("codex 行型(payload role:user)= 非空", async () => {
    mocks.fsReadHead.mockResolvedValue(
      '{"type":"response_item","payload":{"role":"user"}}\n',
    );
    expect(await isJsonlSessionEmpty(PATH)).toBe(false);
  });

  it("kimi 双协议行型(TurnBegin / turn.prompt)= 非空", async () => {
    mocks.fsReadHead.mockResolvedValue('{"message":{"type":"TurnBegin"}}\n');
    expect(await isJsonlSessionEmpty(PATH)).toBe(false);
    mocks.fsReadHead.mockResolvedValue('{"type":"turn.prompt","origin":{"kind":"user"}}\n');
    expect(await isJsonlSessionEmpty(PATH)).toBe(false);
  });

  it("截断行命中子串但 JSON 不完整:保守非空(子串命中即放行,不解析)", async () => {
    mocks.fsReadHead.mockResolvedValue('{"type":"message","message":{"role":"user","con');
    expect(await isJsonlSessionEmpty(PATH)).toBe(false);
  });

  it("读取失败 / 空文件之外的异型返回 = 非空(判不了不删)", async () => {
    mocks.fsReadHead.mockRejectedValue(new Error("missing"));
    expect(await isJsonlSessionEmpty(PATH)).toBe(false);
    mocks.fsReadHead.mockResolvedValue({ weird: true });
    expect(await isJsonlSessionEmpty(PATH)).toBe(false);
  });

  it("真空文件(0 字节)= 空", async () => {
    mocks.fsReadHead.mockResolvedValue("");
    expect(await isJsonlSessionEmpty(PATH)).toBe(true);
  });
});
