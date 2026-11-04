/** 修正层 v2 差量语义单测:migrateV1 / mergeLayer / diffLayer / sameCard。 */
import { describe, expect, it } from "vitest";
import type { FeatureCard } from "./types";
import {
  diffLayer, emptyUserLayer, isEmptyLayer, mergeLayer, migrateV1, sameCard,
} from "./userLayer";

const card = (title: string, sessions: string[] = [], extra: Partial<FeatureCard> = {}): FeatureCard => ({
  title,
  summary: `s-${title}`,
  sessions,
  ...extra,
});

const AI = [
  card("登录", ["a", "b"], { quote: { sid: "a", text: "q1", time: "09:00" } }),
  card("配置", ["c"]),
  card("文档", ["d"]),
];

describe("migrateV1(整量快照 → 差量层)", () => {
  it("题命中内容同=省略,内容异=override,题不匹配=added;AI 缺席不推断 hidden", () => {
    const snapshot = [
      card("登录", ["a", "b"], { quote: { sid: "a", text: "q1", time: "09:00" } }),
      card("配置", ["c"], { summary: "用户改写" }),
      card("手动卡", ["x"]),
    ];
    const layer = migrateV1(snapshot, AI);
    expect(layer.overrides["配置"].summary).toBe("用户改写");
    expect(Object.keys(layer.overrides)).toEqual(["配置"]);
    expect(layer.added.map((c) => c.title)).toEqual(["手动卡"]);
    /* 关键:v1 快照建立时 AI 卡可能尚不存在,缺席≠隐藏(吞卡事故回归线) */
    expect(layer.hidden).toEqual([]);
  });

  it("无 AI 原档:快照全部进 added,hidden 为空(纯手动日语义不变)", () => {
    const layer = migrateV1([card("手动卡", ["x"])], null);
    expect(layer.added.map((c) => c.title)).toEqual(["手动卡"]);
    expect(layer.hidden).toEqual([]);
  });

  it("快照恰=AI 全集 → 空层(等价值,不再吞卡)", () => {
    expect(isEmptyLayer(migrateV1(AI, AI))).toBe(true);
  });
});

describe("mergeLayer(差量层并入 AI 原档)", () => {
  it("AI 顺序为准:override 原位替换,hidden 剔除,added 追加尾部", () => {
    const layer = emptyUserLayer();
    layer.overrides["配置"] = card("配置", ["c", "e"], { summary: "改后" });
    layer.hidden.push("文档");
    layer.added.push(card("手动卡", ["x"]));
    const merged = mergeLayer(AI, layer);
    expect(merged.map((m) => m.card.title)).toEqual(["登录", "配置", "手动卡"]);
    expect(merged.map((m) => m.provenance)).toEqual(["ai", "override", "added"]);
    expect(merged[1].card.sessions).toEqual(["c", "e"]);
  });

  it("空层原样透传 AI 卡,provenance 全 ai", () => {
    const merged = mergeLayer(AI, emptyUserLayer());
    expect(merged.map((m) => m.card.title)).toEqual(["登录", "配置", "文档"]);
    expect(merged.every((m) => m.provenance === "ai")).toBe(true);
  });

  it("AI 原档缺失:仅 added 可见(纯手动日)", () => {
    const layer = emptyUserLayer();
    layer.added.push(card("手动卡", ["x"]));
    expect(mergeLayer(null, layer).map((m) => m.card.title)).toEqual(["手动卡"]);
  });
});

describe("diffLayer(生效卡集 → 差量层)", () => {
  it("零改动 → 空层", () => {
    expect(isEmptyLayer(diffLayer(AI, AI))).toBe(true);
  });

  it("改 summary(题不变)→ override;删卡 → hidden", () => {
    const next = [AI[0], { ...AI[1], summary: "改后" }];
    const layer = diffLayer(AI, next);
    expect(layer.overrides["配置"].summary).toBe("改后");
    expect(layer.hidden).toEqual(["文档"]);
    expect(layer.added).toEqual([]);
  });

  it("重命名 = 旧题 hidden + 新题 added(added 恒在尾部,AI 原卡被 tombstone 抑制)", () => {
    const next = [AI[0], { ...AI[1], title: "配置中心" }, AI[2]];
    const layer = diffLayer(AI, next);
    expect(layer.hidden).toEqual(["配置"]);
    expect(layer.added.map((c) => c.title)).toEqual(["配置中心"]);
    expect(mergeLayer(AI, layer).map((m) => m.card.title)).toEqual(["登录", "文档", "配置中心"]);
  });

  it("重命名回原标题 → 还原为 override,旧 tombstone 不残留", () => {
    const back: FeatureCard[] = [AI[0], { ...AI[1], summary: "改后" }, AI[2]];
    const again = diffLayer(AI, back);
    expect(again.hidden).toEqual([]);
    expect(again.added).toEqual([]);
    expect(again.overrides["配置"].summary).toBe("改后");
  });

  it("手动新增 = added;再隐藏它 = 层清空", () => {
    const manual = card("手动卡", ["x"]);
    const withManual = diffLayer(AI, [...AI, manual]);
    expect(withManual.added.map((c) => c.title)).toEqual(["手动卡"]);
    const reverted = diffLayer(AI, AI);
    expect(isEmptyLayer(reverted)).toBe(true);
  });

  it("无 AI 基底:全部进 added(空态手动补归纳)", () => {
    const layer = diffLayer(null, [card("手动卡", ["x"])]);
    expect(layer.added).toHaveLength(1);
    expect(layer.hidden).toEqual([]);
  });
});

describe("sameCard", () => {
  it("sessions 顺序敏感;quote 缺失归一等价", () => {
    expect(sameCard(card("x", ["a", "b"]), card("x", ["b", "a"]))).toBe(false);
    expect(sameCard(card("x", ["a"]), card("x", ["a"]))).toBe(true);
    expect(sameCard(card("x"), card("x", [], { quote: undefined }))).toBe(true);
  });
});
