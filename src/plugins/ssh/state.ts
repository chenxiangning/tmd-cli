/**
 * ssh 插件状态仓 —— 会话状态/提示/转发快照/SFTP 传输的进程内镜像。
 *
 * 数据源是 Rust 引擎事件(`ssh://event/{id}`、`ssh://prompt/{id}`、`ssh://sftp`):
 * 会话粒度通道由 watchSshSession 动态接线(host 建 SSH 会话时调用),
 * SFTP 传输是全局通道,activate 时常驻接线。组件经 useSyncExternalStore 消费。
 */

import { useSyncExternalStore } from "react";
import {
  ipc,
  onSftpEvent,
  onSshPrompt,
  onSshSessionEvent,
  type SftpTransferState,
  type SshForwardInfo,
  type SshPromptEvent,
  type SshSessionEvent,
} from "@kernel/ipc";

interface SshSessionView {
  status: string;
  message?: string;
  forwards: SshForwardInfo[];
  latencyMs?: number;
  /** 待应答提示(host key 信任 / KBI / 密码回落);应答或取消后由状态事件清除。 */
  prompt: SshPromptEvent | null;
}

interface SshState {
  sessions: Map<string, SshSessionView>;
  transfers: SftpTransferState[];
  /** 主机选择 overlay 开关(菜单/面板入口共用的模块级 UI 总线)。 */
  pickerOpen: boolean;
  pickerWorkspaceId?: string;
}

const state: SshState = {
  sessions: new Map(),
  transfers: [],
  pickerOpen: false,
};

const listeners = new Set<() => void>();
let snapshot: SshState = state;

function notify() {
  snapshot = { ...state, sessions: new Map(state.sessions), transfers: [...state.transfers] };
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function sessionView(sessionId: string): SshSessionView {
  let view = state.sessions.get(sessionId);
  if (!view) {
    view = { status: "connecting", forwards: [], prompt: null };
    state.sessions.set(sessionId, view);
  }
  return view;
}

function applySessionEvent(sessionId: string, event: SshSessionEvent) {
  const view = sessionView(sessionId);
  if (event.kind === "status") {
    view.status = event.status;
    view.message = event.message;
    if (event.status === "connected") view.prompt = null;
  } else if (event.kind === "forwards") {
    view.forwards = event.forwards;
  }
  notify();
}

/* 会话粒度通道的动态订阅表:host 建 SSH 会话时接线,pty://exit 时退订。 */
const dynamicUnlistens = new Map<string, Array<() => void>>();

/** 会话诞生时接线(状态/提示两条会话粒度通道)。幂等。 */
export async function watchSshSession(sessionId: string) {
  if (dynamicUnlistens.has(sessionId)) return;
  const offEvent = await onSshSessionEvent(sessionId, (event) =>
    applySessionEvent(sessionId, event),
  );
  const offPrompt = await onSshPrompt(sessionId, (prompt) => {
    sessionView(sessionId).prompt = prompt;
    notify();
  });
  dynamicUnlistens.set(sessionId, [offEvent, offPrompt]);
}

/** 会话移除时退订并清镜像(pty://exit 消费方调用)。 */
export function unwatchSshSession(sessionId: string) {
  dynamicUnlistens.get(sessionId)?.forEach((off) => off());
  dynamicUnlistens.delete(sessionId);
  if (!state.sessions.delete(sessionId)) return;
  state.transfers = state.transfers.filter((t) => t.sessionId !== sessionId);
  notify();
}

/** 全局接线(activate 一次):SFTP 传输进度通道。返回退订函数。 */
export async function wireSshEvents(): Promise<() => void> {
  return onSftpEvent((event) => {
    const transfer = event.transfer;
    const existing = state.transfers.find((t) => t.id === transfer.id);
    if (existing) {
      Object.assign(existing, transfer);
    } else {
      state.transfers.push(transfer);
    }
    if (["done", "failed", "cancelled"].includes(transfer.status)) {
      /* 终态保留最近 12 条供面板回看,超出滚动丢弃。 */
      const settled = state.transfers.filter((t) =>
        ["done", "failed", "cancelled"].includes(t.status),
      );
      if (settled.length > 12) {
        const drop = new Set(settled.slice(0, settled.length - 12).map((t) => t.id));
        state.transfers = state.transfers.filter((t) => !drop.has(t.id));
      }
    }
    notify();
  });
}

/** 打开主机选择 overlay(无参数 = 当前激活会话所属工作区)。 */
export function openHostPicker(workspaceId?: string) {
  state.pickerOpen = true;
  state.pickerWorkspaceId = workspaceId;
  notify();
}

export function closeHostPicker() {
  if (!state.pickerOpen) return;
  state.pickerOpen = false;
  state.pickerWorkspaceId = undefined;
  notify();
}

/** 全量重拉某会话的转发列表(面板打开时对账;事件流之外的低频兜底)。 */
export async function refreshForwards(sessionId: string) {
  try {
    const forwards = await ipc.sshForwardList(sessionId);
    const view = sessionView(sessionId);
    if (JSON.stringify(view.forwards) === JSON.stringify(forwards)) return;
    view.forwards = forwards;
    notify();
  } catch {
    /* 会话已不存在:列表随 pty://exit 走 unwatchSshSession。 */
  }
}

/** 延迟探测(面板可见时轮询;失败清值,状态卡显示 —)。 */
export async function probeLatency(sessionId: string) {
  try {
    const latencyMs = await ipc.sshLatency(sessionId);
    const view = sessionView(sessionId);
    if (view.latencyMs === latencyMs) return;
    view.latencyMs = latencyMs;
    notify();
  } catch {
    const view = state.sessions.get(sessionId);
    if (view && view.latencyMs !== undefined) {
      view.latencyMs = undefined;
      notify();
    }
  }
}

/* ── React 绑定 ── */

export function useSshState(): SshState {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

export function useSshSession(sessionId: string | null): SshSessionView | null {
  useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
  return sessionId ? (snapshot.sessions.get(sessionId) ?? null) : null;
}

export function useSshTransfers(sessionId: string | null): SftpTransferState[] {
  useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
  return sessionId ? snapshot.transfers.filter((t) => t.sessionId === sessionId) : [];
}

/** 状态文案:状态机的用户可见名(面板/会话卡共用)。 */
export const SSH_STATUS_LABELS: Record<string, string> = {
  connecting: "连接中",
  connected: "已连接",
  reconnecting: "重连中",
  disconnected: "已断开",
  failed: "连接失败",
};
