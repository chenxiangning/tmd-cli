/**
 * F-02 右栏「远程」落地页决策契约 —— remoteHome.ts 纯逻辑:
 * SSH 会话优先;WSL 只看 workspaceOrigins 认领(纯本地工作区不误认);
 * wsl 插件禁用(注册表空)= 回落空态,不感知 wsl 私有格式。
 */

import { afterEach, describe, expect, it } from "vitest";
import { registerWorkspaceOrigin } from "@kernel/workspaceOrigins";
import { resolveRemoteHome } from "./remoteHome";

/* 假 WSL 来源:与 wsl 插件同 id 语义(matches wsl 元数据/UNC root)。 */
const offWsl = registerWorkspaceOrigin({
  id: "wsl",
  label: "WSL",
  matches: (ws) => !!ws.wsl || ws.root.startsWith("\\\\wsl.localhost\\"),
});
afterEach(() => void offWsl);

const localWs = { id: "ws1", root: "/tmp/ws", wsl: null } as never;
const wslLocal = { id: "ws2", root: "\\\\wsl.localhost\\Ubuntu\\home\\x", wsl: { distro: "Ubuntu", hostId: null } } as never;
const wslRemote = { id: "ws3", root: "/home/x", wsl: { distro: "Debian", hostId: "h1" } } as never;

describe("F-02 resolveRemoteHome", () => {
  it("有 SSH 会话 → ssh 视图(运维现场优先,不问工作区来源)", () => {
    expect(resolveRemoteHome(true, null)).toEqual({ kind: "ssh" });
    expect(resolveRemoteHome(true, wslLocal)).toEqual({ kind: "ssh" });
  });

  it("无 SSH 会话:WSL 工作区 → wsl 视图,带发行版与本机/远程标记", () => {
    expect(resolveRemoteHome(false, wslLocal)).toEqual({ kind: "wsl", distro: "Ubuntu", remote: false });
    expect(resolveRemoteHome(false, wslRemote)).toEqual({ kind: "wsl", distro: "Debian", remote: true });
  });

  it("纯本地工作区/无工作区 → empty(不误认为远程)", () => {
    expect(resolveRemoteHome(false, localWs)).toEqual({ kind: "empty" });
    expect(resolveRemoteHome(false, null)).toEqual({ kind: "empty" });
  });

  it("WSL 形态的孤儿工作区(来源未认领)→ empty(伪装成本地即泄漏,同孤儿判定纪律)", () => {
    offWsl();
    const orphan = { id: "ws4", root: "\\\\wsl.localhost\\Ubuntu\\home\\x", wsl: { distro: "Ubuntu", hostId: null } } as never;
    expect(resolveRemoteHome(false, orphan)).toEqual({ kind: "empty" });
  });
});
