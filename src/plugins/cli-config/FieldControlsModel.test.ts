/**
 * FieldControlsModel.test.ts ── cli-config 控件模型纯函数契约:
 * 1. strVal:字符串原样,其余(数字/undefined)回落空串。
 * 2. toOptions:字符串项→{value};函数版收当前表单值;undefined/异型候选回落空数组。
 * 3. withCurrent:当前值不在候选时前置插入;空串当前值不插入;已存在不重复。
 * 4. normOptions:联合(字符串/对象)统一为纯对象。
 * 5. splitModelValue:provider/model/suffix 三段拆分;无斜杠 provider 空、无冒号 suffix 空。
 * 6. rowKey:同内容重复项出现序号加 #n 后缀,seen 跨调用累加。
 * useCatalog 为 React hook,按约定跳过不测。
 */
import { describe, expect, it } from "vitest";
import {
  normOptions,
  rowKey,
  splitModelValue,
  strVal,
  toOptions,
  withCurrent,
} from "./FieldControlsModel";

describe("strVal", () => {
  it("字符串原样,非字符串回落空串", () => {
    expect(strVal("abc")).toBe("abc");
    expect(strVal("")).toBe("");
    expect(strVal(42 as unknown as string)).toBe("");
    expect(strVal(undefined)).toBe("");
  });
});

describe("toOptions", () => {
  it("字符串项规整为 {value} 对象", () => {
    expect(toOptions(["a", "b"])).toEqual([{ value: "a" }, { value: "b" }]);
  });

  it("函数版候选收当前表单值", () => {
    const fn = (values: Record<string, unknown>) => [String(values.mode ?? "none")];
    expect(toOptions(fn, { mode: "fast" })).toEqual([{ value: "fast" }]);
    expect(toOptions(fn)).toEqual([{ value: "none" }]);
  });

  it("undefined/非数组候选回落空数组", () => {
    expect(toOptions(undefined)).toEqual([]);
    expect(toOptions(() => "bad" as unknown as string[])).toEqual([]);
  });
});

describe("withCurrent", () => {
  it("当前值不在候选时前置插入", () => {
    expect(withCurrent([{ value: "a" }], "cur")).toEqual([
      { value: "cur" },
      { value: "a" },
    ]);
  });

  it("已存在(含字符串项)不重复插入", () => {
    expect(withCurrent(["a", "b"], "b")).toEqual(["a", "b"]);
  });

  it("空串当前值不插入", () => {
    expect(withCurrent([{ value: "a" }], "")).toEqual([{ value: "a" }]);
  });
});

describe("normOptions", () => {
  it("联合统一为纯对象,对象项原样保留", () => {
    expect(normOptions(["x", { value: "y", label: "Y" }])).toEqual([
      { value: "x" },
      { value: "y", label: "Y" },
    ]);
  });
});

describe("splitModelValue", () => {
  it("provider/model/suffix 三段完整拆分", () => {
    expect(splitModelValue("openai/gpt-5:fast")).toEqual({
      provider: "openai",
      model: "gpt-5",
      suffix: "fast",
    });
  });

  it("无斜杠 provider 为空;无冒号 suffix 为空", () => {
    expect(splitModelValue("gpt-5")).toEqual({ provider: "", model: "gpt-5", suffix: "" });
    expect(splitModelValue("openai/gpt-5")).toEqual({
      provider: "openai",
      model: "gpt-5",
      suffix: "",
    });
  });

  it("首个斜杠分隔 provider,冒号只看 provider 之后", () => {
    expect(splitModelValue("a/b:c/d")).toEqual({ provider: "a", model: "b", suffix: "c/d" });
  });
});

describe("rowKey", () => {
  it("首次出现用纯内容,重复项追加序号", () => {
    const seen = new Map<string, number>();
    expect(rowKey("a", seen)).toBe("a");
    expect(rowKey("a", seen)).toBe("a#1");
    expect(rowKey("a", seen)).toBe("a#2");
    expect(rowKey("b", seen)).toBe("b");
  });

  it("不同 seen 实例互不串号(每次渲染新建)", () => {
    expect(rowKey("a", new Map())).toBe("a");
    expect(rowKey("a", new Map())).toBe("a");
  });
});
