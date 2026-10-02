import { describe, expect, it } from "vitest";
import { parsePort } from "./portInput";

describe("parsePort(主机表单端口严格校验)", () => {
  it("合法端口通过", () => {
    expect(parsePort("22")).toBe(22);
    expect(parsePort(" 22 ")).toBe(22);
    expect(parsePort("65535")).toBe(65535);
    expect(parsePort("1")).toBe(1);
  });

  it("非纯数字串一律拒(此前 parseInt 放行 22abc/0x16)", () => {
    expect(parsePort("22abc")).toBeNull();
    expect(parsePort("0x16")).toBeNull();
    expect(parsePort("")).toBeNull();
    expect(parsePort("2 2")).toBeNull();
  });

  it("越界拒", () => {
    expect(parsePort("0")).toBeNull();
    expect(parsePort("65536")).toBeNull();
    expect(parsePort("99999999999")).toBeNull();
  });
});
