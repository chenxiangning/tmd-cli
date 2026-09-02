/**
 * composerStage 单测 —— 四段式转移契约:↑ 向展开端逐段走、↓ 向收起端逐段走,两端停。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  collapseComposerStage,
  expandComposerStage,
  getComposerStage,
  setComposerStage,
} from "./composerStage";

describe("composerStage", () => {
  beforeEach(() => setComposerStage("normal"));

  it("↑ 逐级展开:normal → expanded,到顶停", () => {
    expandComposerStage();
    expect(getComposerStage()).toBe("expanded");
    expandComposerStage();
    expect(getComposerStage()).toBe("expanded");
  });

  it("↓ 逐级收起:normal → compact → collapsed,到底停", () => {
    collapseComposerStage();
    expect(getComposerStage()).toBe("compact");
    collapseComposerStage();
    expect(getComposerStage()).toBe("collapsed");
    collapseComposerStage();
    expect(getComposerStage()).toBe("collapsed");
  });

  it("collapsed 起点 ↑:compact → normal → expanded 共三段", () => {
    setComposerStage("collapsed");
    expandComposerStage();
    expect(getComposerStage()).toBe("compact");
    expandComposerStage();
    expect(getComposerStage()).toBe("normal");
    expandComposerStage();
    expect(getComposerStage()).toBe("expanded");
  });
});
