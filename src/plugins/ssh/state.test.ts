/**
 * ssh 插件状态仓行为契约测试。
 * 覆盖:快照引用稳定、连接状态机迁移(终态清提示/非终态保留)、提示接线竞态兜底、
 * watch/unwatch 生命周期、SFTP 传输镜像(按 id 合并/按会话过滤/终态滚动窗)、
 * 主机选择 overlay、转发对账与延迟探测变更检测、状态文案表。
 * 单例 + useSyncExternalStore 读取面:resetModules + 动态 import 取新实例,react 打最小桩。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SftpEventPayload,
  SftpTransferState,
  SshForwardInfo,
  SshPromptEvent,
  SshSessionEvent,
} from "@kernel/ipc";
/* 仅类型引入:运行时实例须经 resetModules + 动态 import 取全新单例,类型面静态可见即可 */
type StateModule = typeof import("./state");

type SshStatus = Extract<SshSessionEvent, { kind: "status" }>["status"];

/* ── @kernel/ipc 最小桩:事件通道收 handler 供测试驱动,ipc 方法逐测试覆写 ── */
const sessionCbs = new Map<string, Set<(e: SshSessionEvent) => void>>();
const promptCbs = new Map<string, Set<(e: SshPromptEvent) => void>>();
const sftpCbs = new Set<(e: SftpEventPayload) => void>();
const ipcMock = {
  sshPromptsPending: vi.fn(),
  sshForwardList: vi.fn(),
  sshLatency: vi.fn(),
  sftpTransfer: vi.fn(),
};
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

vi.mock("@kernel/ipc", () => ({
  ipc: ipcMock,
  onSshSessionEvent: (id: string, cb: (e: SshSessionEvent) => void) =>
    wireSessionChannel(sessionCbs, id, cb),
  onSshPrompt: (id: string, cb: (e: SshPromptEvent) => void) => wireSessionChannel(promptCbs, id, cb),
  onSftpEvent: (cb: (e: SftpEventPayload) => void) => {
    sftpCbs.add(cb);
    return () => sftpCbs.delete(cb);
  },
}));

vi.mock("@kernel/i18n", () => ({
  /* 保留 {name} 插值语义即可,词典查表不属本测契约 */
  t: (key: string, params?: Record<string, string | number>) =>
    params ? key.replace(/\{(\w+)\}/g, (_, n: string) => String(params[n])) : key,
}));

/* react 桩:仅捕获 store 的 subscribe 供挂通知计数器,hook 读取面在 node 直调,不渲染组件 */
let storeSubscribe: ((fn: () => void) => () => void) | undefined;
vi.mock("react", () => ({
  useSyncExternalStore: (subscribe: (fn: () => void) => () => void, getSnapshot: () => unknown) => {
    storeSubscribe = subscribe;
    return getSnapshot();
  },
}));

let mod: StateModule;
let notifyCount = 0;

const statusEvent = (status: SshStatus, message?: string): SshSessionEvent => ({
  kind: "status", status, message, reconnectAttempt: 0, reconnectMaxAttempts: 3,
});
const forward = (id: string): SshForwardInfo => ({
  id, sessionId: "s1", localHost: "127.0.0.1", localPort: 8080,
  remoteHost: "remote", remotePort: 22, status: "active",
});
const transfer = (id: string, status: SftpTransferState["status"], sessionId = "s1"): SftpTransferState => ({
  id, sessionId, direction: "download", status, sourcePath: `/r/${id}`, targetPath: `/l/${id}`,
  bytesDone: 1, bytesTotal: 2, filesDone: 1, filesTotal: 1,
});
const promptEvent = (promptId = "p1"): SshPromptEvent => ({ promptId, kind: "password", echo: false });

const emit = (sid: string, event: SshSessionEvent) => sessionCbs.get(sid)?.forEach((cb) => cb(event));
const emitPrompt = (sid: string, prompt: SshPromptEvent) => promptCbs.get(sid)?.forEach((cb) => cb(prompt));
const fireSftp = (t: SftpTransferState) => sftpCbs.forEach((cb) => cb({ kind: "progress", transfer: t }));
const view = (sid: string) => mod.useSshSession(sid);
const ids = (sid: string) => mod.useSshTransfers(sid).map((t) => t.id);

beforeEach(async () => {
  vi.resetModules();
  /* 动态 import 例外:被测模块是模块级单例,必须借 resetModules 取全新实例 */
  sessionCbs.clear(); promptCbs.clear(); sftpCbs.clear();
  storeSubscribe = undefined;
  notifyCount = 0;
  ipcMock.sshPromptsPending.mockReset().mockResolvedValue([]);
  ipcMock.sshForwardList.mockReset().mockResolvedValue([]);
  ipcMock.sshLatency.mockReset().mockResolvedValue(42);
  ipcMock.sftpTransfer.mockReset().mockResolvedValue(undefined);
  mod = await import("./state");
  mod.useSshState();
  storeSubscribe!(() => { notifyCount++; });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("快照语义与主机选择 overlay", () => {
  it("无变更快照引用稳定,变更后换新引用;open/close 往返且已关闭不重通知", () => {
    const a = mod.useSshState();
    expect(mod.useSshState()).toBe(a);
    mod.openHostPicker("ws1");
    expect(mod.useSshState()).not.toBe(a);
    expect(mod.useSshState().pickerOpen).toBe(true);
    expect(mod.useSshState().pickerWorkspaceId).toBe("ws1");
    mod.closeHostPicker();
    expect(mod.useSshState().pickerOpen).toBe(false);
    expect(mod.useSshState().pickerWorkspaceId).toBeUndefined();
    const before = notifyCount;
    mod.closeHostPicker();
    expect(notifyCount).toBe(before);
    mod.openHostPicker();
    expect(mod.useSshState().pickerOpen).toBe(true);
    expect(mod.useSshState().pickerWorkspaceId).toBeUndefined();
  });
});

describe("连接状态机(status/forwards 事件驱动)", () => {
  it("首事件前无会话视图;status 事件驱动迁移并携带 message", async () => {
    await mod.watchSshSession("s1");
    expect(view("s1")).toBeNull();
    emit("s1", statusEvent("connecting"));
    expect(view("s1")?.status).toBe("connecting");
    emit("s1", statusEvent("connected", "握手完成"));
    expect(view("s1")?.status).toBe("connected");
    expect(view("s1")?.message).toBe("握手完成");
  });

  it("forwards 事件整体替换转发快照;事件按会话隔离不串台", async () => {
    await mod.watchSshSession("s1");
    emit("s2", statusEvent("failed", "boom"));
    expect(view("s2")).toBeNull();
    emit("s1", { kind: "forwards", forwards: [forward("f1")] });
    expect(view("s1")?.forwards.map((f) => f.id)).toEqual(["f1"]);
    emit("s1", { kind: "forwards", forwards: [forward("f1"), forward("f2")] });
    expect(view("s1")?.forwards.map((f) => f.id)).toEqual(["f1", "f2"]);
  });
});

describe("认证提示生命周期", () => {
  it("prompt 事件写入;终态(connected/failed/disconnected)清除,非终态保留", async () => {
    await mod.watchSshSession("s1");
    for (const terminal of ["connected", "failed", "disconnected"] as const) {
      emitPrompt("s1", promptEvent());
      expect(view("s1")?.prompt?.promptId).toBe("p1");
      emit("s1", statusEvent("reconnecting"));
      expect(view("s1")?.prompt?.promptId).toBe("p1");
      emit("s1", statusEvent(terminal));
      expect(view("s1")?.prompt).toBeNull();
    }
  });

  it("接线竞态兜底:采纳同会话未决提示,异会话不采纳", async () => {
    ipcMock.sshPromptsPending.mockResolvedValue([
      { sessionId: "s1", prompt: promptEvent("p-s1") },
      { sessionId: "s2", prompt: promptEvent("p-s2") },
    ]);
    await mod.watchSshSession("s1");
    expect(view("s1")?.prompt?.promptId).toBe("p-s1");
    expect(view("s2")).toBeNull();
  });

  it("sshPromptsPending 失败不阻断接线(纯浏览器 dev 静默)", async () => {
    ipcMock.sshPromptsPending.mockRejectedValue(new Error("no tauri"));
    await expect(mod.watchSshSession("s1")).resolves.toBeUndefined();
    emit("s1", statusEvent("connected"));
    expect(view("s1")?.status).toBe("connected");
  });
});

describe("watch/unwatch 生命周期", () => {
  it("watch 幂等:重复接线不重复订阅;未知会话 unwatch 静默不通知", async () => {
    await mod.watchSshSession("s1");
    await mod.watchSshSession("s1");
    emit("s1", statusEvent("connected"));
    expect(notifyCount).toBe(1);
    expect(() => mod.unwatchSshSession("ghost")).not.toThrow();
    expect(notifyCount).toBe(1);
  });

  it("unwatch 退订:后续事件不再生效且不重复通知", async () => {
    await mod.watchSshSession("s1");
    emit("s1", statusEvent("connected"));
    await mod.unwatchSshSession("s1");
    const before = notifyCount;
    emit("s1", statusEvent("failed", "x"));
    expect(view("s1")).toBeNull();
    expect(notifyCount).toBe(before);
  });

  it("unwatch 清镜像:该会话视图与传输一并移除并通知", async () => {
    await mod.watchSshSession("s1");
    const off = await mod.wireSshEvents();
    fireSftp(transfer("t1", "running"));
    emit("s1", statusEvent("connected"));
    const before = notifyCount;
    await mod.unwatchSshSession("s1");
    expect(notifyCount).toBe(before + 1);
    expect(view("s1")).toBeNull();
    expect(mod.useSshTransfers("s1")).toEqual([]);
    off();
  });

  it("unwatch 未知会话静默且不通知", () => {
    expect(() => mod.unwatchSshSession("ghost")).not.toThrow();
    expect(notifyCount).toBe(0);
  });
});

describe("SFTP 传输镜像(wireSshEvents)", () => {
  it("新传输入表、同 id 原位进度合并;读取面按会话过滤", async () => {
    const off = await mod.wireSshEvents();
    fireSftp(transfer("t1", "running"));
    fireSftp(transfer("t2", "running", "s2"));
    expect(ids("s1")).toEqual(["t1"]);
    fireSftp({ ...transfer("t1", "running"), bytesDone: 99 });
    const mine = mod.useSshTransfers("s1");
    expect(mine).toHaveLength(1);
    expect(mine[0]?.bytesDone).toBe(99);
    off();
  });

  it("终态滚动窗:恰好 12 条全保留;超出丢最老;进行中传输不被清退", async () => {
    const off = await mod.wireSshEvents();
    for (let i = 1; i <= 12; i++) fireSftp(transfer(`t${i}`, "done"));
    expect(ids("s1")).toHaveLength(12);
    expect(ids("s1")).toContain("t1");
    fireSftp(transfer("t13", "done"));
    expect(ids("s1")).not.toContain("t1");
    fireSftp(transfer("r1", "running"));
    for (let i = 14; i <= 16; i++) fireSftp(transfer(`t${i}`, "done"));
    const after = ids("s1");
    expect(after).toContain("r1");
    expect(after).not.toContain("t2");
    expect(after).toContain("t16");
    off();
    fireSftp(transfer("t99", "running"));
    expect(ids("s1")).not.toContain("t99");
  });
});

describe("转发对账 refreshForwards", () => {
  it("列表变化应用并通知;内容相同不重复通知;IPC 失败静默保留旧值", async () => {
    await mod.watchSshSession("s1");
    ipcMock.sshForwardList.mockResolvedValue([forward("f1")]);
    await mod.refreshForwards("s1");
    expect(view("s1")?.forwards.map((f) => f.id)).toEqual(["f1"]);
    const before = notifyCount;
    await mod.refreshForwards("s1");
    expect(notifyCount).toBe(before);
    ipcMock.sshForwardList.mockResolvedValue([forward("f1"), forward("f2")]);
    await mod.refreshForwards("s1");
    expect(view("s1")?.forwards).toHaveLength(2);
    ipcMock.sshForwardList.mockRejectedValue(new Error("gone"));
    await mod.refreshForwards("s1");
    expect(view("s1")?.forwards).toHaveLength(2);
  });
});

describe("延迟探测 probeLatency", () => {
  it("新值应用;同值不通知;失败清值供状态卡回落 —", async () => {
    await mod.watchSshSession("s1");
    emit("s1", statusEvent("connected"));
    await mod.probeLatency("s1");
    expect(view("s1")?.latencyMs).toBe(42);
    const before = notifyCount;
    await mod.probeLatency("s1");
    expect(notifyCount).toBe(before);
    ipcMock.sshLatency.mockRejectedValue(new Error("timeout"));
    await mod.probeLatency("s1");
    expect(view("s1")?.latencyMs).toBeUndefined();
    expect(notifyCount).toBe(before + 1);
    await mod.probeLatency("ghost");
    expect(view("ghost")).toBeNull();
    expect(notifyCount).toBe(before + 1);
  });
});

describe("状态文案表", () => {
  it("覆盖状态机全部五态(面板/会话卡共用)", () => {
    expect(mod.SSH_STATUS_LABELS).toEqual({
      connecting: "连接中", connected: "已连接", reconnecting: "重连中", disconnected: "已断开", failed: "连接失败",
    });
  });
});
