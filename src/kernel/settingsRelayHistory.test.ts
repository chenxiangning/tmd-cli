/**
 * 自建中继部署历史清洗契约测试:白名单收紧 + 坏条目整丢 + 截断上限。
 */
import { describe, expect, it } from "vitest";
import { sanitizeRelayDeployHistory } from "./settingsRelayHistory";

const OK = { host: "1.2.3.4", port: 22, username: "root", authType: "password", savedAt: 1 };

describe("sanitizeRelayDeployHistory", () => {
  it("非数组回落空,坏条目整个丢,合法条目保留", () => {
    expect(sanitizeRelayDeployHistory(null)).toEqual([]);
    expect(sanitizeRelayDeployHistory([OK, "junk", { host: "", port: 22, username: "x" }])).toEqual([OK]);
  });

  it("port 越界/非整数丢弃;authType 白名单外回落 password", () => {
    expect(sanitizeRelayDeployHistory([{ ...OK, port: 0 }])).toEqual([]);
    expect(sanitizeRelayDeployHistory([{ ...OK, port: 70000 }])).toEqual([]);
    expect(sanitizeRelayDeployHistory([{ ...OK, authType: "ssh" }])[0].authType).toBe("password");
  });

  it("privateKeyPath 留空不写入,超长截断;总量截到上限 10", () => {
    expect("privateKeyPath" in sanitizeRelayDeployHistory([OK])[0]).toBe(false);
    const long = sanitizeRelayDeployHistory([{ ...OK, privateKeyPath: "x".repeat(600) }])[0];
    expect(long.privateKeyPath).toHaveLength(500);
    const many = Array.from({ length: 15 }, (_, i) => ({ ...OK, host: `h${i}` }));
    expect(sanitizeRelayDeployHistory(many)).toHaveLength(10);
  });
});
