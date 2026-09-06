/**
 * opencode auth.json 解析纯函数单测 —— 凭据盘点数据源契约守卫。
 */
import { describe, expect, it } from "vitest";
import { parseOpencodeAuth } from "./opencodeDisk";

describe("parseOpencodeAuth", () => {
  it("api 型带 key,oauth 型无 key", () => {
    expect(
      parseOpencodeAuth(
        JSON.stringify({
          openai: { type: "oauth", access: "x", accountId: "y", expires: 1 },
          "zhipuai-coding-plan": { type: "api", key: "sk-..." },
        }),
      ),
    ).toEqual([
      { providerId: "openai" },
      { providerId: "zhipuai-coding-plan", key: "sk-..." },
    ]);
  });

  it("损坏 JSON / 数组 / 空对象 = null(盘点按未配置降级)", () => {
    expect(parseOpencodeAuth("not json")).toBeNull();
    expect(parseOpencodeAuth("[]")).toBeNull();
    expect(parseOpencodeAuth("{}")).toBeNull();
  });
});
