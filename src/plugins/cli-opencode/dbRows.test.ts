/**
 * dbRows.test.ts ── opencode.db 行解析纯函数契约:
 * 1. opencodeDiskSessionRows:行→会话映射、畸形行(id 缺失/异型)剔除、
 *    modifiedAt 取 time_updated 优先回落 time_created 再回落 0、
 *    createdAt 为 0/缺失时为 undefined、路径为 <dbPath>#<id> 合成。
 * 2. opencodeIdentityRow:null 行回 null;directory/time_created 异型收窄。
 * 3. parseOpencodeMessageModel:assistant 顶层形态与 user 嵌套形态双支持;
 *    缺 provider 或 model、非对象、空串均回 null。
 * 4. parseOpencodeModelVariant:缺失/"default"/异型回 undefined,显式档位保留。
 * 5. opencodeSessionStatus:两者皆缺回 null;单有其一也合成对象。
 * 6. opencodeUserMessageRows:畸形行剔除、同 id 多部件保留首条、空文本剔除。
 * 7. parseOpencodeToolEdit:仅已完成 write/edit 产出事件;ts 取 state.time.end
 *    优先回落行 ts 再回落 0;cwd 传入走 normalizeEditPath;缺失 filePath 回 null。
 */
import { describe, expect, it } from "vitest";
import {
  opencodeDiskSessionRows,
  opencodeIdentityRow,
  opencodeSessionStatus,
  opencodeUserMessageRows,
  parseOpencodeMessageModel,
  parseOpencodeModelVariant,
  parseOpencodeToolEdit,
} from "./dbRows";

describe("opencodeDiskSessionRows", () => {
  it("正常行映射出完整会话字段", () => {
    const rows = [["s1", "标题", 100, 200]];
    expect(opencodeDiskSessionRows("/a/opencode.db", rows)).toEqual([
      {
        id: "s1",
        title: "标题",
        modifiedAt: 200,
        createdAt: 100,
        path: "/a/opencode.db#s1",
      },
    ]);
  });

  it("time_updated 缺失回落 time_created,再回落 0", () => {
    expect(opencodeDiskSessionRows("/d.db", [["s1", "t", 100, null]])![0]!.modifiedAt).toBe(100);
    expect(opencodeDiskSessionRows("/d.db", [["s1", "t", null, null]])![0]!.modifiedAt).toBe(0);
  });

  it("createdAt 为 0 或异型时为 undefined", () => {
    expect(opencodeDiskSessionRows("/d.db", [["s1", "t", 0, 5]])![0]!.createdAt).toBeUndefined();
    expect(opencodeDiskSessionRows("/d.db", [["s1", "t", "x", 5]])![0]!.createdAt).toBeUndefined();
  });

  it("id 缺失/空串/异型的行被剔除,其余保留", () => {
    const rows = [[null, "t", 1, 2], ["", "t", 1, 2], [123, "t", 1, 2], ["ok", "t", 1, 2]];
    expect(opencodeDiskSessionRows("/d.db", rows).map((s) => s.id)).toEqual(["ok"]);
  });

  it("title 异型收窄为 undefined", () => {
    expect(opencodeDiskSessionRows("/d.db", [["s1", 42, 1, 2]])![0]!.title).toBeUndefined();
  });
});

describe("opencodeIdentityRow", () => {
  it("null 行回 null", () => {
    expect(opencodeIdentityRow("s1", null)).toBeNull();
  });

  it("directory/time_created 异型收窄为 undefined", () => {
    expect(opencodeIdentityRow("s1", [123, null])).toEqual({ id: "s1", cwd: undefined, createdAt: undefined });
  });

  it("正常行映射 id/cwd/createdAt", () => {
    expect(opencodeIdentityRow("s1", ["/home/proj", 99])).toEqual({
      id: "s1",
      cwd: "/home/proj",
      createdAt: 99,
    });
  });
});

describe("parseOpencodeMessageModel", () => {
  it("assistant 顶层形态:providerID/modelID 直取", () => {
    expect(parseOpencodeMessageModel({ providerID: "anthropic", modelID: "claude" })).toEqual({
      provider: "anthropic",
      model: "claude",
    });
  });

  it("user 嵌套形态:model.providerID/model.modelID 优先", () => {
    expect(
      parseOpencodeMessageModel({ model: { providerID: "openai", modelID: "gpt" } }),
    ).toEqual({ provider: "openai", model: "gpt" });
  });

  it("缺 provider 或 model 回 null(含空串)", () => {
    expect(parseOpencodeMessageModel({ providerID: "a" })).toBeNull();
    expect(parseOpencodeMessageModel({ modelID: "m" })).toBeNull();
    expect(parseOpencodeMessageModel({ providerID: "", modelID: "m" })).toBeNull();
  });

  it("非对象输入回 null", () => {
    expect(parseOpencodeMessageModel(null)).toBeNull();
    expect(parseOpencodeMessageModel("x")).toBeNull();
    expect(parseOpencodeMessageModel(42)).toBeNull();
  });

  it("model 字段为异型(字符串)时不炸,走顶层兜底", () => {
    expect(parseOpencodeMessageModel({ model: "weird" })).toBeNull();
  });
});

describe("parseOpencodeModelVariant", () => {
  it("显式档位保留,default/缺失/异型回 undefined", () => {
    expect(parseOpencodeModelVariant({ variant: "high" })).toBe("high");
    expect(parseOpencodeModelVariant({ variant: "default" })).toBeUndefined();
    expect(parseOpencodeModelVariant({})).toBeUndefined();
    expect(parseOpencodeModelVariant({ variant: 1 })).toBeUndefined();
    expect(parseOpencodeModelVariant(null)).toBeUndefined();
  });
});

describe("opencodeSessionStatus", () => {
  it("两者皆缺回 null", () => {
    expect(opencodeSessionStatus(null, undefined)).toBeNull();
  });

  it("模型串 = provider/model,thinkingLevel = variant", () => {
    expect(opencodeSessionStatus({ provider: "a", model: "m" }, "high")).toEqual({
      model: "a/m",
      thinkingLevel: "high",
    });
  });

  it("只有其一也合成对象,缺侧字段为 undefined", () => {
    expect(opencodeSessionStatus({ provider: "a", model: "m" }, undefined)).toEqual({
      model: "a/m",
      thinkingLevel: undefined,
    });
    expect(opencodeSessionStatus(null, "high")).toEqual({ model: undefined, thinkingLevel: "high" });
  });
});

describe("opencodeUserMessageRows", () => {
  it("正常行映射,同 id 多部件保留首条", () => {
    const rows = [["m1", "第一"], ["m1", "重复"], ["m2", "第二"]];
    expect(opencodeUserMessageRows(rows)).toEqual([
      { id: "m1", text: "第一" },
      { id: "m2", text: "第二" },
    ]);
  });

  it("id 缺失或文本异型/空串的行剔除", () => {
    const rows = [[null, "x"], ["m1", null], ["m2", 1], ["m3", ""], ["m4", " "]];
    expect(opencodeUserMessageRows(rows)).toEqual([{ id: "m4", text: " " }]);
  });
});

describe("parseOpencodeToolEdit", () => {
  const writeTool = {
    type: "tool",
    tool: "write",
    state: { status: "completed", input: { filePath: "/p/a.ts" }, time: { end: 555 } },
  };

  it("已完成的 write/edit 产出事件,ts 取 state.time.end", () => {
    expect(parseOpencodeToolEdit(writeTool, 1)).toEqual({ path: "/p/a.ts", ts: 555 });
  });

  it("time.end 缺失回落行 ts,再回落 0", () => {
    const noEnd = { ...writeTool, state: { ...writeTool.state, time: {} } };
    expect(parseOpencodeToolEdit(noEnd, 42)).toEqual({ path: "/p/a.ts", ts: 42 });
    expect(parseOpencodeToolEdit(noEnd, undefined)).toEqual({ path: "/p/a.ts", ts: 0 });
  });

  it("非 tool / 非 write-edit / 未完成 / 缺 filePath 均回 null", () => {
    expect(parseOpencodeToolEdit({ type: "text" }, 1)).toBeNull();
    expect(parseOpencodeToolEdit({ type: "tool", tool: "bash", state: writeTool.state }, 1)).toBeNull();
    expect(
      parseOpencodeToolEdit({ ...writeTool, state: { ...writeTool.state, status: "pending" } }, 1),
    ).toBeNull();
    expect(
      parseOpencodeToolEdit(
        { ...writeTool, state: { status: "completed", input: {} } },
        1,
      ),
    ).toBeNull();
  });

  it("非对象输入与缺 state 回 null", () => {
    expect(parseOpencodeToolEdit(null, 1)).toBeNull();
    expect(parseOpencodeToolEdit("x", 1)).toBeNull();
    expect(parseOpencodeToolEdit({ type: "tool", tool: "write" }, 1)).toBeNull();
  });

  it("cwd 传入时路径经 normalizeEditPath 归一(cwd 内相对化)", () => {
    const inCwd = {
      type: "tool",
      tool: "edit",
      state: { status: "completed", input: { filePath: "/ws/src/a.ts" } },
    };
    expect(parseOpencodeToolEdit(inCwd, 1, "/ws")).toEqual({ path: "src/a.ts", ts: 1 });
  });
});
