/**
 * 修正层二期纯聚合(mergeCards/splitCard)契约测试。
 * vi.mock 隔离模块级副作用(文件顶部 import 链含 ipc/settings),聚合逻辑本身零依赖。
 */
import { describe, expect, it, vi } from "vitest";
import type { FpCardView } from "../dataSource";

vi.mock("@kernel/i18n", () => ({ t: (k: string) => k }));
vi.mock("../rollup", () => ({ saveUserCards: vi.fn(async () => undefined) }));
vi.mock("../fpTab", () => ({ bumpFootprintRev: vi.fn(), useFootprintRev: () => 0 }));

const { mergeCards, splitCard } = await import("./useFpFix");

const card = (title: string, sessions: string[], extra: Partial<FpCardView> = {}): FpCardView => ({
  title,
  summary: `s-${title}`,
  sessions,
  unverified: false,
  ...extra,
});

const BASE = [
  card("登录", ["a", "b"], { quote: { sid: "a", text: "q1", time: "09:00" } }),
  card("配置", ["b", "c"], { quote: { sid: "c", text: "q2", time: "10:00" } }),
  card("文档", ["d"]),
];

describe("mergeCards", () => {
  it("源卡会话并入目标卡(去重),quote 保留目标卡自有", () => {
    const out = mergeCards(BASE, "文档", "配置");
    expect(out.map((c) => c.title)).toEqual(["登录", "配置"]);
    expect(out[1].sessions).toEqual(["b", "c", "d"]);
    expect(out[1].quote?.sid).toBe("c");
  });

  it("目标卡无 quote 时继承源卡", () => {
    const out = mergeCards(BASE, "配置", "文档");
    expect(out.find((c) => c.title === "文档")?.quote?.sid).toBe("c");
  });

  it("源卡缺失原样返回", () => {
    expect(mergeCards(BASE, "不存在", "配置")).toBe(BASE);
  });
});

describe("splitCard", () => {
  it("勾选会话移入新卡,新卡插源卡后;quote 随其 sid 走", () => {
    const out = splitCard(BASE, "登录", "登录-后端", ["b"]);
    expect(out.map((c) => c.title)).toEqual(["登录", "登录-后端", "配置", "文档"]);
    expect(out[1].sessions).toEqual(["b"]);
    expect(out[1].quote).toBeUndefined();
    expect(out[0].sessions).toEqual(["a"]);
    expect(out[0].quote?.sid).toBe("a");
  });

  it("quote.sid 被拆走时跟随新卡;源卡拆空则移除", () => {
    const out = splitCard(BASE, "登录", "仅A", ["a", "b"]);
    expect(out.map((c) => c.title)).toEqual(["仅A", "配置", "文档"]);
    expect(out[0].quote?.sid).toBe("a");
  });

  it("空勾选原样返回", () => {
    expect(splitCard(BASE, "登录", "x", [])).toBe(BASE);
  });
});
