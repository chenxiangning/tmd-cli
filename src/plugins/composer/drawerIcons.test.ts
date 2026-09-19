/**
 * 抽屉图标解析契约 —— profile 声明 `icon: "<语义名>"` → DRAWER_ICONS 内置集解析。
 * 协议(头注原文):未声明或名称未收录 = 按 section 回退通用 glyph,
 * 不留空白、不报错 —— 降级链 iconNode > 已收录语义名 > Puzzle 兜底 > null
 * (null 由调用方再回退 SECTION_GLYPHS 分区缺省 glyph)。
 * 覆盖:resolveDrawerIcon 优先级链与未知名降级、SECTION_GLYPHS 分区协议、
 * DRAWER_ICONS 注册表可用性(值均为可渲染组件引用)。
 */
import { describe, expect, it } from "vitest";
import { PuzzlePiece } from "@phosphor-icons/react";
import { DRAWER_ICONS, SECTION_GLYPHS, resolveDrawerIcon } from "./drawerIcons";

/** 任意非空组件引用即可参与身份断言,无需真实渲染。 */
const FakePanelIcon = () => null;

describe("resolveDrawerIcon 优先级链", () => {
  it("iconNode 优先于语义名(插件面板自带图标不被语义名遮蔽)", () => {
    expect(resolveDrawerIcon({ icon: "model", iconNode: FakePanelIcon })).toBe(
      FakePanelIcon,
    );
  });

  it("已收录语义名解析为注册表对应组件(身份一致,允许内部重映射)", () => {
    expect(resolveDrawerIcon({ icon: "model" })).toBe(DRAWER_ICONS.model);
    expect(resolveDrawerIcon({ icon: "help" })).toBe(DRAWER_ICONS.help);
  });

  it("未收录语义名降级为 Puzzle 兜底,不抛错也不返回 null(协议:不留空白)", () => {
    expect(resolveDrawerIcon({ icon: "no-such-semantic-name" })).toBe(
      PuzzlePiece,
    );
  });

  it("未声明 icon(缺字段/undefined/空串)返回 null,交调用方回退分区 glyph", () => {
    expect(resolveDrawerIcon({})).toBeNull();
    expect(resolveDrawerIcon({ icon: undefined })).toBeNull();
    /* 空串边界:falsy 判定必须同「未声明」,不得落进 Puzzle 伪装成有图标 */
    expect(resolveDrawerIcon({ icon: "" })).toBeNull();
  });
});

describe("SECTION_GLYPHS 分区缺省 glyph 协议", () => {
  it("四个分区均有非空缺省 glyph(图标解析终级兜底不留空白)", () => {
    for (const sec of ["command", "skill", "mcp", "plugin"] as const) {
      expect((SECTION_GLYPHS[sec] ?? "").length, `分区 ${sec} 缺 glyph`).toBeGreaterThan(0);
    }
  });

  it("命令/技能 glyph 镜像触发符(/ 与 $),展示不得谎报触发语义", () => {
    expect(SECTION_GLYPHS.command).toBe("/");
    expect(SECTION_GLYPHS.skill).toBe("$");
  });
});

describe("DRAWER_ICONS 注册表可用性", () => {
  it("每个语义名都映射到组件引用(登记漏值 = 契约单测白名单失真)", () => {
    for (const [name, component] of Object.entries(DRAWER_ICONS)) {
      expect(component, `语义名 ${name} 的映射值为空`).toBeTruthy();
    }
  });
});
