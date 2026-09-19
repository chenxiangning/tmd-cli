/**
 * kimi 会话判空契约测试(isKimiSessionEmpty,经共享 isJsonlSessionEmpty 组合)。
 * 覆盖:双候选位顺序探测(新布局 agents/main/wire.jsonl 优先,老布局
 * 根下 wire.jsonl 兜底);新布局判空即短路、不再探测老布局;新布局缺失时
 * 老布局兜底判空;两处都读不到 → false(保守不删);头部含用户消息标记
 * 子串 → false;头部异型(非字符串)按判不了处理并回落老布局。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fsReadHead: vi.fn(),
}));

vi.mock("@kernel/ipc", () => ({
  ipc: { fsReadHead: mocks.fsReadHead },
}));

import { isKimiSessionEmpty } from "./kimiEmpty";

const PATH = "/ws/.kimi/sessions/s1";
const NEW = `${PATH}/agents/main/wire.jsonl`;
const OLD = `${PATH}/wire.jsonl`;

function headByPath(head: Record<string, string | Error>) {
  mocks.fsReadHead.mockImplementation((path: string) => {
    const v = head[path];
    if (v instanceof Error) return Promise.reject(v);
    return Promise.resolve(v);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isKimiSessionEmpty 双候选位探测", () => {
  it("新布局可读且无用户消息标记 → true,且短路不再探测老布局", async () => {
    headByPath({ [NEW]: '{"type":"custom"}\n{"type":"custom"}' });
    expect(await isKimiSessionEmpty(PATH)).toBe(true);
    expect(mocks.fsReadHead).toHaveBeenCalledTimes(1);
    expect(mocks.fsReadHead.mock.calls[0][0]).toBe(NEW);
  });

  it("新布局缺失,老布局可读且空 → true(老 home ≤0.34 兜底)", async () => {
    headByPath({ [NEW]: new Error("enoent"), [OLD]: "" });
    expect(await isKimiSessionEmpty(PATH)).toBe(true);
  });

  it("两处都读不到 → false(判不了不删的保守闸语义)", async () => {
    headByPath({ [NEW]: new Error("enoent"), [OLD]: new Error("enoent") });
    expect(await isKimiSessionEmpty(PATH)).toBe(false);
  });

  it("新布局含用户消息标记 → false,仍探测老布局(仅判空才短路)", async () => {
    headByPath({ [NEW]: '{"message":{"role":"user","content":"hi"}}', [OLD]: new Error("enoent") });
    expect(await isKimiSessionEmpty(PATH)).toBe(false);
    expect(mocks.fsReadHead).toHaveBeenCalledTimes(2);
  });

  it("双候选都有用户消息(新 role:user、老 TurnBegin)→ false", async () => {
    headByPath({
      [NEW]: '{"message":{"role":"user","content":"hi"}}',
      [OLD]: '{"event":"TurnBegin"}',
    });
    expect(await isKimiSessionEmpty(PATH)).toBe(false);
  });

  it("新布局缺失、老布局含 TurnBegin(kimi 1.1 行型)→ false", async () => {
    headByPath({ [NEW]: new Error("enoent"), [OLD]: '{"event":"TurnBegin"}' });
    expect(await isKimiSessionEmpty(PATH)).toBe(false);
  });

  it("新布局头部异型(非字符串)按判不了处理,回落老布局判空", async () => {
    headByPath({
      [NEW]: { unexpected: "object" } as unknown as string,
      [OLD]: '{"type":"custom"}',
    });
    expect(await isKimiSessionEmpty(PATH)).toBe(true);
  });
});
