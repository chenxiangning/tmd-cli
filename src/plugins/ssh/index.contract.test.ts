/**
 * ssh 插件注册面与生命周期契约基线(批次 B-04 护栏;F-01/F-02 前置可比基线)。
 * 覆盖 checklist 六护栏中的 ssh 四项:
 * - 模块加载重接线:webview reload 后 Rust 会话存活,import 即重拉会话表并逐个接线;
 * - SFTP 全局通道:activate 常驻接线,deactivate 摘除;
 * - 会话退出清理:sessionsChanged 接线 ⇄ sessionExited 退订,退后可重接线(不幂等锁死);
 * - 远程编辑关闭闸:脏 tab 关闭先 askDialog 确认,确认丢弃才清草稿镜像,取消不清。
 * 数据层行为契约(state.test.ts)不动,本文件只钉 index 装配面。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SftpEventPayload,
  SshPromptEvent,
  SshSessionEvent,
} from "@kernel/ipc";

/* ── @kernel/ipc 最小桩:事件通道收 handler,ipc.sessionList 模拟 reload 存活会话 ── */
const sessionCbs = new Map<string, Set<(e: SshSessionEvent) => void>>();
const promptCbs = new Map<string, Set<(e: SshPromptEvent) => void>>();
const sftpCbs = new Set<(e: SftpEventPayload) => void>();
const wireSessionChannel = <E,>(
  store: Map<string, Set<(e: E) => void>>,
  sessionId: string,
  cb: (e: E) => void,
) => {
  let set = store.get(sessionId);
  if (!set) store.set(sessionId, (set = new Set()));
  set.add(cb);
  return () => set?.delete(cb);
};

const ipcMock = {
  sessionList: vi.fn(),
  sshPromptsPending: vi.fn(),
  sshForwardList: vi.fn(),
};
vi.mock("@kernel/ipc", () => ({
  ipc: ipcMock,
  onSshSessionEvent: (id: string, cb: (e: SshSessionEvent) => void) =>
    wireSessionChannel(sessionCbs, id, cb),
  onSshPrompt: (id: string, cb: (e: SshPromptEvent) => void) =>
    wireSessionChannel(promptCbs, id, cb),
  onSftpEvent: (cb: (e: SftpEventPayload) => void) => {
    sftpCbs.add(cb);
    return () => sftpCbs.delete(cb);
  },
}));
vi.mock("@kernel/i18n", () => ({
  t: (key: string, params?: Record<string, string | number>) =>
    params ? key.replace(/\{(\w+)\}/g, (_, n: string) => String(params[n])) : key,
  registerMessages: vi.fn(),
}));
const askDialogMock = vi.hoisted(() => ({ askDialog: vi.fn() }));
vi.mock("@kernel/askDialog", () => askDialogMock);
const draftMirrorMock = vi.hoisted(() => ({ draftMirrorClear: vi.fn() }));
vi.mock("@kernel/draftMirror", () => draftMirrorMock);

import { KernelTopics } from "@kernel/events";
import type { PluginContext } from "@kernel/plugin";

type IndexModule = typeof import("./index");
type HostApi = (typeof import("@kernel/host"))["host"];

let mod: IndexModule;
let host: HostApi;

const sessionEventCalls = (id: string) => {
  let n = 0;
  for (const [sid, set] of sessionCbs) if (sid === id) n += set.size;
  return n;
};

function harness() {
  const contributes: Array<{ slot: string; order?: number }> = [];
  const tabContents: Array<{ kind: string; beforeClose?: (tab: unknown) => Promise<boolean> }> = [];
  const commands: Array<{ id: string; keybinding?: string }> = [];
  const panels: Array<{ id: string; label: string; component: unknown }> = [];
  const sections: string[] = [];
  const ctx = {
    contribute: (slot: string, c: { order?: number }) => {
      contributes.push({ slot, order: c.order });
    },
    registerTabContent: (c: { kind: string; beforeClose?: (tab: unknown) => Promise<boolean> }) => {
      tabContents.push(c);
    },
    registerCommand: (c: { id: string; keybinding?: string }) =>
      commands.push({ id: c.id, keybinding: c.keybinding }),
    registerFilePanel: (p: { id: string; label: string; component: unknown }) => panels.push(p),
    registerSettingsSection: (s: { id: string }) => sections.push(s.id),
    events: host.events,
  } as unknown as PluginContext;
  return { ctx, contributes, tabContents, commands, panels, sections };
}

beforeEach(async () => {
  vi.resetModules();
  sessionCbs.clear(); promptCbs.clear(); sftpCbs.clear();
  askDialogMock.askDialog.mockReset();
  draftMirrorMock.draftMirrorClear.mockReset();
  /* 默认:reload 后无存活 SSH 会话;「模块加载重接线」用例覆写。 */
  ipcMock.sessionList.mockReset().mockResolvedValue([]);
  ipcMock.sshPromptsPending.mockReset().mockResolvedValue([]);
  ipcMock.sshForwardList.mockReset().mockResolvedValue([]);
  host = (await import("@kernel/host")).host;
  mod = await import("./index");
});

afterEach(() => {
  mod.sshPlugin.deactivate?.();
  vi.restoreAllMocks();
});

describe("ssh 模块加载重接线(webview reload 兜底)", () => {
  it("import 即重拉会话表:存活 SSH 会话逐个接状态/提示线并账转发", async () => {
    vi.resetModules();
    sessionCbs.clear(); promptCbs.clear(); sftpCbs.clear();
    ipcMock.sessionList.mockResolvedValue([{ id: "reload-1", kind: "ssh" }]);
    await import("./index");
    /* 单会话接线:事件通道与提示通道各一条,转发对账一次。 */
    await vi.waitFor(() => {
      expect(sessionEventCalls("reload-1")).toBe(1);
      expect(promptCbs.get("reload-1")?.size).toBe(1);
    });
    expect(ipcMock.sshForwardList).toHaveBeenCalledWith("reload-1");
  });
});

describe("ssh activate 注册面", () => {
  it("四挂载点 + 面板 + 设置分区 + ⌘S 命令一次登记", () => {
    const h = harness();
    mod.sshPlugin.activate(h.ctx);
    expect(h.contributes).toEqual([
      { slot: "overlay", order: 30 },
      { slot: "workspace.newSessionMenu", order: 20 },
    ]);
    expect(h.tabContents.map((t) => t.kind)).toEqual(["ssh-file"]);
    expect(h.commands).toEqual([{ id: "ssh.saveRemoteFile", keybinding: "Cmd+S" }]);
    expect(h.sections).toEqual(["ssh"]);
  });

  it("F-02 右栏面板:label「远程」承接落地页,面板 id 保持 ssh(persisted 钉住不迁移)", async () => {
    const { RemoteHomePanel } = await import("./panel/RemoteHomePanel");
    const h = harness();
    mod.sshPlugin.activate(h.ctx);
    expect(h.panels).toHaveLength(1);
    expect(h.panels[0].id).toBe("ssh");
    expect(h.panels[0].label).toBe("远程");
    expect(h.panels[0].component).toBe(RemoteHomePanel);
  });

  it("SFTP 全局通道 activate 常驻接线,deactivate 摘除", async () => {
    const h = harness();
    mod.sshPlugin.activate(h.ctx);
    expect(sftpCbs.size).toBe(1);
    /* wireSshEvents 的退订句柄经 then 微任务入账,先冲洗再断。 */
    await new Promise((r) => setTimeout(r, 0));
    mod.sshPlugin.deactivate!();
    await new Promise((r) => setTimeout(r, 0));
    expect(sftpCbs.size).toBe(0);
    /* 再 activate 重接线(deactivate 幂等安全,不双份)。 */
    mod.sshPlugin.activate(h.ctx);
    await new Promise((r) => setTimeout(r, 0));
    expect(sftpCbs.size).toBe(1);
  });
});

describe("ssh 会话生命周期接线", () => {
  it("sessionsChanged 接线 SSH 会话;sessionExited 退订清镜像,可重接线不锁死", async () => {
    const h = harness();
    mod.sshPlugin.activate(h.ctx);
    host.events.emit(KernelTopics.sessionsChanged, [{ id: "s1", kind: "ssh" }]);
    /* 等 watch 完整落地(sshPromptsPending 调用在 dynamicUnlistens.set 之后),
     * 只等事件回调入账就发退出会让 unwatch 抢在登记前空转。 */
    await vi.waitFor(() => expect(ipcMock.sshPromptsPending.mock.calls.length).toBeGreaterThan(0));
    expect(sessionEventCalls("s1")).toBe(1);
    /* 退出:退订 + 清镜像。 */
    host.events.emit(KernelTopics.sessionExited, "s1");
    await vi.waitFor(() => expect(sessionEventCalls("s1")).toBe(0));
    /* 同会话再出现(重连/恢复):重新接线 —— 若退出未退订,幂等 watch 会锁死在 0 次重订。 */
    host.events.emit(KernelTopics.sessionsChanged, [{ id: "s1", kind: "ssh" }]);
    await vi.waitFor(() => expect(sessionEventCalls("s1")).toBe(1));
  });

  it("deactivate 后事件不再触达接线(无幽灵 watch)", async () => {
    const h = harness();
    mod.sshPlugin.activate(h.ctx);
    mod.sshPlugin.deactivate!();
    host.events.emit(KernelTopics.sessionsChanged, [{ id: "s2", kind: "ssh" }]);
    await new Promise((r) => setTimeout(r, 20));
    expect(sessionEventCalls("s2")).toBe(0);
  });
});

describe("ssh 远程编辑关闭闸(beforeClose)", () => {
  const tab = (dirty: boolean, path?: string) =>
    ({ dirty, payload: path ? { path } : null }) as never;

  it("干净 tab 直接放行,不问不清理", async () => {
    const h = harness();
    mod.sshPlugin.activate(h.ctx);
    const beforeClose = h.tabContents[0].beforeClose!;
    await expect(beforeClose(tab(false, "/r/x"))).resolves.toBe(true);
    expect(askDialogMock.askDialog).not.toHaveBeenCalled();
    expect(draftMirrorMock.draftMirrorClear).not.toHaveBeenCalled();
  });

  it("脏 tab 确认丢弃:放行并清草稿镜像(防重开复活已弃内容)", async () => {
    const h = harness();
    mod.sshPlugin.activate(h.ctx);
    askDialogMock.askDialog.mockResolvedValue(true);
    const beforeClose = h.tabContents[0].beforeClose!;
    await expect(beforeClose(tab(true, "/r/x"))).resolves.toBe(true);
    expect(askDialogMock.askDialog).toHaveBeenCalledTimes(1);
    expect(draftMirrorMock.draftMirrorClear).toHaveBeenCalledWith("ssh-file:/r/x");
  });

  it("脏 tab 取消:不放行,镜像保留", async () => {
    const h = harness();
    mod.sshPlugin.activate(h.ctx);
    askDialogMock.askDialog.mockResolvedValue(false);
    const beforeClose = h.tabContents[0].beforeClose!;
    await expect(beforeClose(tab(true, "/r/x"))).resolves.toBe(false);
    expect(draftMirrorMock.draftMirrorClear).not.toHaveBeenCalled();
  });
});
