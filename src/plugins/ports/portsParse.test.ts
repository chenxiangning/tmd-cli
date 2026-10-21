/**
 * ports · 解析器单测 —— fixtures 取自本机真实命令输出(mac lsof/ps/lsof -Fn)
 * 与各平台形态样例(ss/netstat 双平台/PowerShell CSV),锁死解析形状。
 */

import { describe, expect, it } from "vitest";
import {
  decodeLsofName,
  parseLsofCwd,
  parseLsofListeners,
  parseNetstatListeners,
  parsePowershellProcs,
  parsePsTree,
  parseShBatch,
  parseSsListeners,
  splitHostPort,
} from "./portsParse";

/** 本机真实 `lsof -nP -iTCP -sTCP:LISTEN +c0` 节选(2026-10-21 捕获)。 */
const MAC_LSOF = `COMMAND                              PID          USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
rapportd                             687 chenxiangning   10u  IPv4 0x2cc6e3a869339139      0t0  TCP *:56932 (LISTEN)
rapportd                             687 chenxiangning   11u  IPv6 0x2490a0db4401e3cd      0t0  TCP *:56932 (LISTEN)
ControlCenter                        692 chenxiangning   14u  IPv4 0xff8523e16d46a640      0t0  TCP *:5000 (LISTEN)
netdisk_service                      864 chenxiangning   10u  IPv4 0x69c0fa3e39ef2511      0t0  TCP 127.0.0.1:10000 (LISTEN)
Google\\x20Chrome\\x20for\\x20Testing 13394 chenxiangning   54u  IPv4 0x62a095a1815914e      0t0  TCP 127.0.0.1:63547 (LISTEN)`;

describe("parseLsofListeners(mac lsof 真实形态)", () => {
  it("尾部 8 列定位 + 命令名空格归头部", () => {
    const rows = parseLsofListeners(MAC_LSOF);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({ pid: 687, host: "*", port: 56932 });
    expect(rows[2]).toEqual({ pid: 692, host: "*", port: 5000 });
    expect(rows[3]).toEqual({ pid: 864, host: "127.0.0.1", port: 10000 });
    expect(rows[4]).toEqual({ pid: 13394, host: "127.0.0.1", port: 63547 });
  });

  it("decodeLsofName 还原 \\xNN 转义", () => {
    expect(decodeLsofName("Google\\x20Chrome\\x20for\\x20Testing")).toBe("Google Chrome for Testing");
  });
});

describe("parseSsListeners(linux ss)", () => {
  it("users 提 pid,无 users 为 null,[::1] 方括号拆分", () => {
    const text = `State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process
LISTEN 0      128    0.0.0.0:22        0.0.0.0:*         users:(("sshd",pid=888,fd=3))
LISTEN 0      5      [::1]:631         [::]:*`;
    expect(parseSsListeners(text)).toEqual([
      { pid: 888, host: "0.0.0.0", port: 22 },
      { pid: null, host: "::1", port: 631 },
    ]);
  });
});

describe("parseNetstatListeners(windows/linux 双形态)", () => {
  it("windows LISTENING 列取 pid", () => {
    const text = `
  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       1234
  TCP    127.0.0.1:5000         127.0.0.1:5001         ESTABLISHED     999
  TCP    [::]:8080              [::]:0                 LISTENING       777`;
    expect(parseNetstatListeners(text, true)).toEqual([
      { pid: 1234, host: "0.0.0.0", port: 3000 },
      { pid: 777, host: "::", port: 8080 },
    ]);
  });

  it("linux LISTEN 行 pid/name,无权限为 - → null", () => {
    const text = `tcp        0      0 0.0.0.0:22          0.0.0.0:*            LISTEN      987/sshd
tcp6       0      0 :::8080             :::*                 LISTEN      -`;
    expect(parseNetstatListeners(text, false)).toEqual([
      { pid: 987, host: "0.0.0.0", port: 22 },
      { pid: null, host: "::", port: 8080 },
    ]);
  });
});

describe("parsePsTree(ps -axo pid=,ppid=,args=)", () => {
  it("首两列 pid/ppid,其余整段为 args", () => {
    const text = `  424     1 /System/Library/CoreServices/loginwindow.app/Contents/MacOS/loginwindow console
  713     1 /usr/bin/python3 -m http.server 8931`;
    const map = parsePsTree(text);
    expect(map.get(424)).toEqual({ ppid: 1, name: "", args: "/System/Library/CoreServices/loginwindow.app/Contents/MacOS/loginwindow console" });
    expect(map.get(713)?.args).toBe("/usr/bin/python3 -m http.server 8931");
  });
});

describe("parseLsofCwd(lsof -Fn 块流,本机真实形态)", () => {
  it("p/f/n 块取 cwd", () => {
    const text = "p80529\nfcwd\nn/Users/chenxiangning/code/AI/github/tmd-cli";
    expect(parseLsofCwd(text).get(80529)).toBe("/Users/chenxiangning/code/AI/github/tmd-cli");
  });
});

describe("parsePowershellProcs(CSV,引号内逗号)", () => {
  it("表头定位列,引号内逗号不切列", () => {
    const text = `"ProcessId","ParentProcessId","Name","CommandLine"
"687","1","rapportd","/System/rapportd --args a,b"
"692","1","ControlCenter",`;
    const map = parsePowershellProcs(text);
    expect(map.get(687)).toEqual({ ppid: 1, name: "rapportd", args: "/System/rapportd --args a,b" });
    expect(map.get(692)?.args).toBe("");
  });
});

describe("parseShBatch(cwd readlink / git rev-parse 批循环共用)", () => {
  it("tab 分隔键值,空值保留空串", () => {
    const map = parseShBatch("/repo\t/repo\n/tmp\t\n");
    expect(map.get("/repo")).toBe("/repo");
    expect(map.get("/tmp")).toBe("");
  });
});

describe("splitHostPort", () => {
  it("四种地址形态", () => {
    expect(splitHostPort("*:56932")).toEqual({ host: "*", port: 56932 });
    expect(splitHostPort("127.0.0.1:10000")).toEqual({ host: "127.0.0.1", port: 10000 });
    expect(splitHostPort("[::]:8080")).toEqual({ host: "::", port: 8080 });
    expect(splitHostPort("[fe80::1]:443")).toEqual({ host: "fe80::1", port: 443 });
    expect(splitHostPort(":::8080")).toEqual({ host: "::", port: 8080 });
  });
});
