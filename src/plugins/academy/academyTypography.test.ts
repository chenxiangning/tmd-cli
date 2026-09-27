/**
 * 学堂排版护栏 —— px 字号复发即静默破坏 settings.uiFontSize 缩放(2026-09-26 实证
 * 失效类:初版全 px 被客户端拉大一号)。机械断言:字号必须 rem;控件继承必须
 * 以 :where 压零特异性,否则压死后置类级声明(同日实证回归)。
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dirname, "academy.css"), "utf8");

describe("academy 排版铁律(architecture/15)", () => {
  it("字号全 rem,禁 px 硬编码", () => {
    const pxSizes = css.match(/font-size:\s*[\d.]+px/g) ?? [];
    expect(pxSizes, `字号必须 rem(px 不随 uiFontSize):${pxSizes.join(", ")}`).toEqual([]);
  });

  it("控件继承 reset 以 :where 压零特异性", () => {
    expect(css).toContain(":where(.academy-entry, .academy-guide, .academy-wizard) :is(button, input)");
  });
});
