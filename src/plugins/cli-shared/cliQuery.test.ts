import { describe, expect, it } from "vitest";

import { extractJsonObjects } from "./cliQuery";

describe("extractJsonObjects", () => {
  it("基线:标准 JSONL 逐行提取", () => {
    const buf = '{"type":"ready"}\n{"id":"m1","type":"response","success":true}\n';
    const objs = extractJsonObjects(buf);
    expect(objs).toHaveLength(2);
    expect(objs[1]).toMatchObject({ id: "m1", type: "response", success: true });
  });

  it("应答行被后续截断事件粘尾(无换行)仍可认领", () => {
    const resp = JSON.stringify({ id: "m1", type: "response", success: true, data: { commands: [] } });
    const buf = `{"type":"ready"}\n${resp}{"type":"available_commands_upd`;
    const objs = extractJsonObjects(buf);
    expect(objs).toContainEqual(
      expect.objectContaining({ id: "m1", type: "response" }),
    );
  });

  it("前导噪声与对象间噪声不干扰提取", () => {
    const buf = 'noise line\n{"a":1}junk{"id":"m1","type":"response"}tail';
    const objs = extractJsonObjects(buf);
    expect(objs).toEqual([{ a: 1 }, { id: "m1", type: "response" }]);
  });

  it("字符串内的花括号/引号转义不破坏深度计数", () => {
    const obj = { id: "m1", description: '含 } 与 {"嵌套"} 与 \\" 转义' };
    const buf = `${JSON.stringify(obj)}\n{"x":2}\n`;
    const objs = extractJsonObjects(buf);
    expect(objs[0]).toMatchObject({ id: "m1" });
    expect(objs[1]).toEqual({ x: 2 });
  });

  it("应答完整、尾部对象截断(杀树竞态)时跳过截断段", () => {
    const buf = '{"ok":true}\n{"trunc": {"a":1';
    expect(extractJsonObjects(buf)).toEqual([{ ok: true }]);
  });

  it("\\r\\n 行尾与多字节内容正常解析", () => {
    const buf = '{"id":"m1","desc":"中文描述"}\r\n{"b":2}\r\n';
    expect(extractJsonObjects(buf)).toEqual([
      { id: "m1", desc: "中文描述" },
      { b: 2 },
    ]);
  });
});
