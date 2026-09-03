/**
 * sshSettings 清洗测试 —— settings.ssh.hosts 的 sanitize 契约。
 */

import { describe, expect, it } from "vitest";
import { sanitizeSshSettings } from "./sshSettings";

describe("sanitizeSshSettings", () => {
  it("空/畸形输入回落空簿", () => {
    expect(sanitizeSshSettings(undefined)).toEqual({ hosts: [] });
    expect(sanitizeSshSettings(null)).toEqual({ hosts: [] });
    expect(sanitizeSshSettings({ hosts: "nope" })).toEqual({ hosts: [] });
    expect(sanitizeSshSettings({ hosts: [null, 42, "x"] })).toEqual({ hosts: [] });
  });

  it("必填齐全的条目保留,凭据截断保形", () => {
    const result = sanitizeSshSettings({
      hosts: [
        {
          id: " h1 ",
          name: "  Prod  ",
          host: " prod.example.com ",
          port: 2222,
          username: " root ",
          authType: "privateKey",
          password: "",
          privateKey: `-----BEGIN OPENSSH PRIVATE KEY-----\n${"A".repeat(70_000)}`,
          privateKeyPath: "~/.ssh/prod",
          privateKeyPassphrase: "secret",
        },
      ],
    });
    expect(result.hosts).toHaveLength(1);
    const host = result.hosts[0];
    expect(host.id).toBe("h1");
    expect(host.name).toBe("Prod");
    expect(host.host).toBe("prod.example.com");
    expect(host.username).toBe("root");
    expect(host.port).toBe(2222);
    /* 私钥超长截断(64K 上限),保形不保真 —— 连接前 Rust 侧还有 PEM 清洗兜底。 */
    expect(host.privateKey.length).toBeLessThanOrEqual(64_000);
  });

  it("缺 id/host/username 丢弃;重复 id 先到先得", () => {
    const result = sanitizeSshSettings({
      hosts: [
        { id: "a", host: "a.com", username: "u" },
        { id: "a", host: "b.com", username: "u" },
        { host: "c.com", username: "u" },
        { id: "c", host: "", username: "u" },
        { id: "d", host: "d.com", username: " " },
      ],
    });
    expect(result.hosts.map((h) => h.id)).toEqual(["a"]);
    expect(result.hosts[0].host).toBe("a.com");
  });

  it("端口越界归零(连接时回落 22),authType 非法回落 password", () => {
    const result = sanitizeSshSettings({
      hosts: [
        { id: "p1", host: "a.com", username: "u", port: 70000, authType: "magic" },
      ],
    });
    expect(result.hosts[0].port).toBe(0);
    expect(result.hosts[0].authType).toBe("password");
  });

  it("代理清洗:socks 归一 socks5,全空代理丢弃,非法类型丢弃", () => {
    const result = sanitizeSshSettings({
      hosts: [
        {
          id: "h1",
          host: "a.com",
          username: "u",
          proxy: { type: "socks", url: "127.0.0.1", port: 1080, username: "", password: "" },
        },
        {
          id: "h2",
          host: "b.com",
          username: "u",
          proxy: { type: "", url: "", port: 0, username: "", password: "" },
        },
        {
          id: "h3",
          host: "c.com",
          username: "u",
          proxy: { type: "vpn", url: "x", port: 1, username: "", password: "" },
        },
      ],
    });
    expect(result.hosts[0].proxy?.type).toBe("socks5");
    expect(result.hosts[1].proxy).toBeUndefined();
    expect(result.hosts[2].proxy).toBeUndefined();
  });

  it("条目数上限 200(超出丢弃)", () => {
    const hosts = Array.from({ length: 260 }, (_, i) => ({
      id: `h${i}`,
      host: `h${i}.com`,
      username: "u",
    }));
    expect(sanitizeSshSettings({ hosts }).hosts).toHaveLength(200);
  });
});
