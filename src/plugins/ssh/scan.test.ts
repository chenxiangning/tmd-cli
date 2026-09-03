/**
 * scan.ts 纯函数测试 —— identity 路径跨平台展开与 ~/.ssh/config 解析
 * (路径展开与 config 解析行为用例)。
 */

import { describe, expect, it } from "vitest";
import { expandIdentityPath, isPrivateKeyContent, parseSshConfig, sshHostIdentityKey } from "./scan";

describe("expandIdentityPath · POSIX", () => {
  const home = "/Users/alice";

  it("展开 ~ / $HOME / ${HOME} 前缀", () => {
    expect(expandIdentityPath(home, "~/.ssh/id_ed25519")).toBe("/Users/alice/.ssh/id_ed25519");
    expect(expandIdentityPath(home, "$HOME/.ssh/id_rsa")).toBe("/Users/alice/.ssh/id_rsa");
    expect(expandIdentityPath(home, "${HOME}/.ssh/id_rsa")).toBe("/Users/alice/.ssh/id_rsa");
  });

  it("绝对路径原样(去尾斜杠),相对路径按 home 拼", () => {
    expect(expandIdentityPath(home, "/opt/keys/id_ed25519")).toBe("/opt/keys/id_ed25519");
    expect(expandIdentityPath(home, "keys/id_ed25519")).toBe("/Users/alice/keys/id_ed25519");
  });

  it("空串与包裹引号", () => {
    expect(expandIdentityPath(home, "")).toBe("");
    expect(expandIdentityPath(home, '"~/.ssh/id_rsa"')).toBe("/Users/alice/.ssh/id_rsa");
  });
});

describe("expandIdentityPath · Windows", () => {
  const home = "C:\\Users\\Alice";

  it("展开 %USERPROFILE% 与 %HOMEDRIVE%%HOMEPATH%", () => {
    expect(expandIdentityPath(home, "%USERPROFILE%\\.ssh\\id_rsa")).toBe(
      "C:\\Users\\Alice\\.ssh\\id_rsa",
    );
    expect(expandIdentityPath(home, "%HOMEDRIVE%%HOMEPATH%\\.ssh\\id_rsa")).toBe(
      "C:\\Users\\Alice\\.ssh\\id_rsa",
    );
  });

  it("盘符绝对路径与 UNC 原样,裸盘符名按相对处理", () => {
    expect(expandIdentityPath(home, "C:\\Keys\\prod key")).toBe("C:\\Keys\\prod key");
    expect(expandIdentityPath(home, "\\\\server\\share\\id_rsa")).toBe("\\\\server\\share\\id_rsa");
    expect(expandIdentityPath(home, "C:Keys\\id_rsa")).toBe("C:\\Users\\Alice\\C:Keys\\id_rsa");
  });

  it("波浪与前缀变量展开", () => {
    expect(expandIdentityPath(home, "~\\.ssh\\id_ed25519")).toBe(
      "C:\\Users\\Alice\\.ssh\\id_ed25519",
    );
    expect(expandIdentityPath(home, "${HOME}\\.ssh\\id_ed25519")).toBe(
      "C:\\Users\\Alice\\.ssh\\id_ed25519",
    );
  });
});

describe("parseSshConfig", () => {
  it("Host 别名 + HostName/User/Port/IdentityFile,通配与注释丢弃", () => {
    const config = [
      "# 顶部注释",
      "Host web-prod",
      "  HostName prod.example.com",
      "  User deploy",
      "  Port 2222",
      "  IdentityFile ~/.ssh/prod_key # 行内注释",
      "",
      "Host *.internal",
      "  User ec2-user",
      "",
      "Host plain",
      "  User root",
    ].join("\n");
    const hosts = parseSshConfig(config);
    expect(hosts).toHaveLength(2);
    expect(hosts[0]).toEqual({
      alias: "web-prod",
      host: "prod.example.com",
      username: "deploy",
      port: 2222,
      identityFile: "~/.ssh/prod_key",
    });
    /* 无 HostName 的别名段:host 回落别名,端口回落 22。 */
    expect(hosts[1].host).toBe("plain");
    expect(hosts[1].port).toBe(22);
  });

  it("非法端口回落 22", () => {
    const hosts = parseSshConfig("Host x\n  Port 99999\n  User u");
    expect(hosts[0].port).toBe(22);
  });
});

describe("私钥识别与主机身份键", () => {
  it("PEM 头识别(多算法),公钥/普通文本不认", () => {
    expect(isPrivateKeyContent("-----BEGIN OPENSSH PRIVATE KEY-----\nAAA\n-----END OPENSSH PRIVATE KEY-----")).toBe(true);
    expect(isPrivateKeyContent("-----BEGIN RSA PRIVATE KEY-----\nAAA\n-----END RSA PRIVATE KEY-----")).toBe(true);
    expect(isPrivateKeyContent("ssh-ed25519 AAAAC3 user@host")).toBe(false);
    expect(isPrivateKeyContent("")).toBe(false);
  });

  it("身份键归一(host 小写 + 端口缺省 22 + 用户小写)", () => {
    expect(sshHostIdentityKey({ host: "Example.COM ", port: 0, username: " Root" })).toBe(
      sshHostIdentityKey({ host: "example.com", port: 22, username: "root" }),
    );
    expect(sshHostIdentityKey({ host: "a.com", port: 22, username: "u" })).not.toBe(
      sshHostIdentityKey({ host: "a.com", port: 2222, username: "u" }),
    );
  });
});
