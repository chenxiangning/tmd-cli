/**
 * session-relay 插件桥协议测试(与 ExitSessionToast.test.tsx 的桥闸范式同源):
 * - activate 登记双桥(退出卡快照 relayOpenRef / tab 右键活会话 relayLiveRef),
 *   cleanup 双置 null(null 闸 = 插件停用后调用面自动消钮);
 * - 活会话桥组源:仅本地 CLI 会话,且携带源自己的 cwd/workspaceId
 *   (tab 条是跨工作区 MRU,缺席会在跨工作区接力时静默丢史/落错工作区)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sessions = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("@kernel/host", () => ({
  host: {
    getSessions: () => sessions,
    getCliSessionId: (id: string) => (id === "pty-1" ? "uuid-1" : undefined),
    getCliProfile: (id: string) => ({ id, name: id.toUpperCase() }),
    getSessionStatus: () => undefined,
  },
}));
const setRelaySource = vi.fn();
vi.mock("./relayStore", () => ({
  setRelaySource: (src: unknown) => setRelaySource(src),
  clearRelaySource: () => undefined,
  useRelaySource: () => null,
}));
vi.mock("../marks/store", () => ({ stagedMarks: () => [], setMarkState: () => undefined }));

import { relayLiveRef, relayOpenRef } from "@kernel/relayBridge";
import { sessionRelayPlugin } from "./index";

function stubCtx(): never {
  return { registerCommand: vi.fn(), contribute: vi.fn() } as never;
}

/** 每测自登记活桥(activate 置 ref,与生产同路径)。 */
async function registerLiveBridge(): Promise<void> {
  await sessionRelayPlugin.activate(stubCtx());
}

describe("接力桥协议", () => {
  beforeEach(() => {
    relayLiveRef.current = null;
    relayOpenRef.current = null;
    setRelaySource.mockClear();
  });

  it("activate 登记双桥,cleanup 双置 null", async () => {
    const cleanup = (await sessionRelayPlugin.activate(stubCtx())) as () => void;
    expect(relayLiveRef.current).toBeTypeOf("function");
    expect(relayOpenRef.current).toBeTypeOf("function");
    cleanup();
    expect(relayLiveRef.current).toBeNull();
    expect(relayOpenRef.current).toBeNull();
  });

  it("活会话桥:CLI 会话组源携带源 cwd/workspaceId(跨工作区 tab 接力不失源)", async () => {
    await registerLiveBridge();
    sessions.length = 0;
    sessions.push({
      id: "pty-1",
      kind: "cli",
      profileId: "omp",
      cwd: "/w/other",
      workspaceId: "ws2",
      title: "T",
    });
    relayLiveRef.current?.("pty-1");
    expect(setRelaySource).toHaveBeenCalledTimes(1);
    const src = setRelaySource.mock.calls[0][0] as Record<string, unknown>;
    expect(src.cwd).toBe("/w/other");
    expect(src.workspaceId).toBe("ws2");
    expect(src.cliSessionId).toBe("uuid-1");
  });

  it("shell/ssh/已退出会话:不开框", async () => {
    await registerLiveBridge();
    sessions.length = 0;
    sessions.push({ id: "pty-2", kind: "shell", profileId: "shell", cwd: "/w", workspaceId: "ws1", title: "T" });
    relayLiveRef.current?.("pty-2");
    relayLiveRef.current?.("pty-404");
    expect(setRelaySource).not.toHaveBeenCalled();
  });
});
