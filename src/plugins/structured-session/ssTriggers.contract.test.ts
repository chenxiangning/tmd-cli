/**
 * RPC 输入面触发符契约 —— ssComposer 复用 PTY composer 的 @ 文件 / $ skill
 * 触发器,但 "/" 必须滤除:RPC tab 已有基于 getCommands 的专属命令补全,
 * profile 的 "/" 触发符再激活会出现双下拉竞争。
 */

import { describe, expect, it } from "vitest";
import type { CliProfile } from "@kernel/cli";
import { rpcTriggerSpecs } from "./ssTriggers";

const base = { id: "pi", name: "pi" } as unknown as CliProfile;

describe("rpcTriggerSpecs", () => {
  it("滤除 / 触发符,保留 @ 文件与 $ skill", () => {
    const p = {
      ...base,
      triggers: [
        { char: "/", kind: "command" },
        { char: "@", kind: "file" },
        { char: "$", kind: "skill" },
      ],
    } as unknown as CliProfile;
    const out = rpcTriggerSpecs(p);
    expect(out?.triggers?.map((s) => s.char)).toEqual(["@", "$"]);
    /* 浅拷贝:其余字段引用不变 */
    expect(out?.id).toBe("pi");
  });

  it("无 / 触发符的 profile 原样返回(引用不变,memo 友好)", () => {
    const p = {
      ...base,
      triggers: [{ char: "@", kind: "file" }],
    } as unknown as CliProfile;
    expect(rpcTriggerSpecs(p)).toBe(p);
  });

  it("null profile 原样返回", () => {
    expect(rpcTriggerSpecs(null)).toBeNull();
  });
});
