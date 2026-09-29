import { describe, expect, it } from "vitest";
import type { IntentCanvasIndexEntry } from "../types";
import {
  groupCanvasEntriesByEra,
  STALE_ERA_THRESHOLD_DAYS,
} from "../utils/eraGrouping";

function createEntry(id: string, updatedAt: Date, elementCount = 1): IntentCanvasIndexEntry {
  return {
    id,
    title: id,
    mode: "architect",
    summary: "",
    updatedAt: updatedAt.toISOString(),
    createdAt: updatedAt.toISOString(),
    path: `${id}.intent-canvas.json`,
    linkedFileCount: 0,
    linkedProjectMapNodeCount: 0,
    linkedThreadCount: 0,
    elementCount,
  };
}

// 2026-08-13 是周四；本周起点为 2026-08-10（周一）00:00 本地。
const NOW = new Date(2026, 7, 13, 12, 0, 0);

describe("groupCanvasEntriesByEra", () => {
  it("returns no eras for an empty list", () => {
    expect(groupCanvasEntriesByEra([], NOW)).toEqual([]);
  });

  it("groups entries into week, month, and stale eras in order", () => {
    const entries = [
      createEntry("canvas-week", new Date(2026, 7, 12, 9)),
      createEntry("canvas-aug-early", new Date(2026, 7, 2, 9)),
      createEntry("canvas-jul", new Date(2026, 6, 20, 9)),
      createEntry("canvas-stale", new Date(2026, 4, 1, 9)),
    ];

    const eras = groupCanvasEntriesByEra(entries, NOW);

    expect(eras.map((era) => era.kind)).toEqual(["week", "month", "month", "stale"]);
    expect(eras[0].entries.map((entry) => entry.id)).toEqual(["canvas-week"]);
    expect(eras[1].month).toBe(8);
    expect(eras[1].entries.map((entry) => entry.id)).toEqual(["canvas-aug-early"]);
    expect(eras[2].month).toBe(7);
    expect(eras[3].entries.map((entry) => entry.id)).toEqual(["canvas-stale"]);
  });

  it("treats Monday 00:00 of the current week as the week era boundary", () => {
    const mondayStart = new Date(2026, 7, 10, 0, 0, 0);
    const sundayBefore = new Date(2026, 7, 9, 23, 59, 59);

    const eras = groupCanvasEntriesByEra(
      [createEntry("canvas-monday", mondayStart), createEntry("canvas-sunday", sundayBefore)],
      NOW,
    );

    expect(eras[0].kind).toBe("week");
    expect(eras[0].entries.map((entry) => entry.id)).toEqual(["canvas-monday"]);
    expect(eras[1].kind).toBe("month");
    expect(eras[1].month).toBe(8);
    expect(eras[1].entries.map((entry) => entry.id)).toEqual(["canvas-sunday"]);
  });

  it("moves entries at the stale threshold into the stale era", () => {
    const boundary = new Date(NOW.getTime() - STALE_ERA_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);
    const justInside = new Date(boundary.getTime() + 60 * 1000);

    const eras = groupCanvasEntriesByEra(
      [createEntry("canvas-boundary", boundary), createEntry("canvas-inside", justInside)],
      NOW,
    );

    const staleEra = eras.find((era) => era.kind === "stale");
    expect(staleEra?.entries.map((entry) => entry.id)).toEqual(["canvas-boundary"]);
    expect(eras.some((era) => era.entries.some((entry) => entry.id === "canvas-inside"))).toBe(true);
    expect(staleEra?.maxStaleDays).toBe(STALE_ERA_THRESHOLD_DAYS);
  });

  it("aggregates canvas count, element sum, and max stale days", () => {
    const entries = [
      createEntry("canvas-a", new Date(2026, 7, 12, 9), 10),
      createEntry("canvas-b", new Date(2026, 7, 11, 9), 20),
      createEntry("canvas-old", new Date(2026, 0, 1, 9), 5),
    ];

    const eras = groupCanvasEntriesByEra(entries, NOW);
    const week = eras.find((era) => era.kind === "week");
    const stale = eras.find((era) => era.kind === "stale");

    expect(week?.canvasCount).toBe(2);
    expect(week?.elementSum).toBe(30);
    expect(stale?.maxStaleDays).toBeGreaterThan(200);
  });

  it("keeps input order inside an era", () => {
    const entries = [
      createEntry("canvas-new", new Date(2026, 7, 13, 10)),
      createEntry("canvas-old", new Date(2026, 7, 11, 10)),
    ];

    const eras = groupCanvasEntriesByEra(entries, NOW);
    expect(eras[0].entries.map((entry) => entry.id)).toEqual(["canvas-new", "canvas-old"]);
  });

  it("sends unparseable updatedAt values into the stale era", () => {
    const entry = createEntry("canvas-bad", NOW);
    entry.updatedAt = "not-a-date";

    const eras = groupCanvasEntriesByEra([entry], NOW);
    expect(eras).toHaveLength(1);
    expect(eras[0].kind).toBe("stale");
  });
});
