import { describe, expect, it } from "vitest";
import type { DayNoteImage } from "./journalFiles";
import { mergePastedImage } from "./noteDraftState";

const image = (file: string): DayNoteImage => ({ file, name: file });

describe("便签贴图代次", () => {
  it("乱序完成也基于最新图片集追加,不互相覆盖", () => {
    const first = mergePastedImage([], image("first.png"), 1, 1)!;
    const second = mergePastedImage(first, image("second.png"), 1, 1)!;
    expect(second.map((img) => img.file)).toEqual(["first.png", "second.png"]);
  });

  it("取消或重进编辑后,旧代次迟到结果不得回写", () => {
    expect(mergePastedImage([], image("late.png"), 1, 2)).toBeNull();
  });
});
