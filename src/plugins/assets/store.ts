/**
 * 资产库存储 —— 智能体(agents.json)与提示词(两级 md 目录)的内存单源。
 *
 * 磁盘布局(~/.tmd-cli/ 平铺,通用 fs_* 原语读写,Rust 零改动):
 * - agents.json:{agents: Record<id, Agent>, selectedBySession: Record<sessionId, id>}
 * - prompts/<name>.md:全局提示词
 * - workspaces/<wsId>/prompts/<name>.md:工作区级提示词(按 tmd workspace id 分目录,
 *   不写入用户仓库)
 *
 * activate 时 loadAssets 一次(等 workspacesReady,工作区级目录才齐);设置页写操作
 * 落盘并同步内存;composer 触发源/发送变换只读内存。外部手改文件不 watch,重开生效。
 * 提示词 CRUD 与消费面拆在 promptStore.ts(文件规模铁则),共享下方 state/emit/tmdHome。
 */

import { useSyncExternalStore } from "react";
import type { CliSuggestion } from "@kernel/cli";
import { ipc } from "@kernel/ipc";
import { getWorkspaces, workspacesReady } from "@kernel/workspace";
import { parsePromptFile } from "./promptMd";

export interface Agent {
  id: string;
  name: string;
  icon?: string;
  prompt: string;
  createdAt: number;
}

export type PromptScope = "global" | "workspace";

export interface PromptEntry {
  name: string;
  scope: PromptScope;
  /** scope = workspace 时归属的工作区 id。 */
  wsId?: string;
  description?: string;
  argumentHint?: string;
  content: string;
}

interface AssetsState {
  loaded: boolean;
  agents: Agent[];
  prompts: PromptEntry[];
  selectedBySession: Record<string, string>;
}

/* ── 插件内共享(promptStore.ts 直接消费;插件外只走下方公开 API)── */

export const state: AssetsState = { loaded: false, agents: [], prompts: [], selectedBySession: {} };
const listeners = new Set<() => void>();
let snapshot: AssetsState = state;

export function emit(): void {
  snapshot = {
    loaded: state.loaded,
    agents: [...state.agents],
    prompts: [...state.prompts],
    selectedBySession: { ...state.selectedBySession },
  };
  listeners.forEach((fn) => fn());
}

let cachedHome = "";
/** tmd 家目录(~/.tmd-cli);settings.json/workspaces.json 同层的平铺惯例。 */
export async function tmdHome(): Promise<string> {
  if (!cachedHome) cachedHome = `${await ipc.configHomeDir()}/.tmd-cli`;
  return cachedHome;
}

async function readPromptDir(dir: string, scope: PromptScope, wsId?: string): Promise<PromptEntry[]> {
  const entries = await ipc.fsWalkFiles(dir, 2000).catch(() => [] as string[]);
  const out: PromptEntry[] = [];
  for (const entry of entries) {
    /* 平铺约定:子目录不递归(与 codemoss prompts 目录同形态) */
    if (entry.includes("/") || !entry.endsWith(".md")) continue;
    const text = await ipc.fsReadFile(`${dir}/${entry}`).catch(() => "");
    if (!text.trim()) continue;
    out.push({ name: entry.slice(0, -".md".length), scope, wsId, ...parsePromptFile(text) });
  }
  return out;
}

export async function loadAssets(): Promise<void> {
  const base = await tmdHome().catch(() => "");
  if (!base) {
    state.loaded = true;
    emit();
    return;
  }
  const raw = await ipc.fsReadFile(`${base}/agents.json`).catch(() => "");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as {
        agents?: Record<string, Agent>;
        selectedBySession?: Record<string, string>;
      };
      state.agents = Object.values(parsed.agents ?? {}).filter(
        (a) => a && typeof a.id === "string" && typeof a.name === "string" && typeof a.prompt === "string",
      );
      state.selectedBySession = { ...(parsed.selectedBySession ?? {}) };
    } catch {
      /* 坏文件 = 空库,不拖垮启动 */
    }
  }
  /* 等工作区表就绪,工作区级提示词目录才枚举得全 */
  await workspacesReady;
  const wsDirs = await Promise.all(
    getWorkspaces().map((ws) => readPromptDir(`${base}/workspaces/${ws.id}/prompts`, "workspace", ws.id)),
  );
  state.prompts = [...(await readPromptDir(`${base}/prompts`, "global")), ...wsDirs.flat()];
  state.loaded = true;
  emit();
}

/* ── 智能体 CRUD + 会话选择 ── */

async function persistAgents(): Promise<void> {
  const agents: Record<string, Agent> = {};
  for (const a of state.agents) agents[a.id] = a;
  await ipc.fsWriteFile(
    `${await tmdHome()}/agents.json`,
    JSON.stringify({ agents, selectedBySession: state.selectedBySession }, null, 2),
  );
}

/** 新建/编辑智能体;名称(大小写不敏感)撞车或写盘失败返回 null。 */
export async function saveAgent(input: { id?: string; name: string; icon?: string; prompt: string }): Promise<Agent | null> {
  const name = input.name.trim();
  if (!name) return null;
  if (state.agents.some((a) => a.id !== input.id && a.name.toLowerCase() === name.toLowerCase())) return null;
  const agent: Agent = {
    id: input.id ?? `agent-${crypto.randomUUID().slice(0, 8)}`,
    name,
    icon: input.icon?.trim() || undefined,
    prompt: input.prompt,
    createdAt: state.agents.find((a) => a.id === input.id)?.createdAt ?? Date.now(),
  };
  const prev = state.agents;
  state.agents = [...state.agents.filter((a) => a.id !== agent.id), agent].sort((a, b) => a.createdAt - b.createdAt);
  try {
    await persistAgents();
  } catch {
    state.agents = prev;
    return null;
  }
  emit();
  return agent;
}

/** 删除智能体;写盘失败回滚内存并返回 false(调用处提示,同 saveAgent 模式)。 */
export async function deleteAgent(id: string): Promise<boolean> {
  const prevAgents = state.agents;
  const prevSelected = { ...state.selectedBySession };
  state.agents = state.agents.filter((a) => a.id !== id);
  for (const [sid, aid] of Object.entries(state.selectedBySession)) {
    if (aid === id) delete state.selectedBySession[sid];
  }
  try {
    await persistAgents();
  } catch {
    state.agents = prevAgents;
    state.selectedBySession = prevSelected;
    emit();
    return false;
  }
  emit();
  return true;
}

/** 会话级智能体选择(持久化进 agents.json);null = 取消;写盘失败回滚并返回 false。 */
export async function selectAgent(sessionId: string, agentId: string | null): Promise<boolean> {
  const prev = state.selectedBySession[sessionId];
  if (agentId) state.selectedBySession[sessionId] = agentId;
  else delete state.selectedBySession[sessionId];
  try {
    await persistAgents();
  } catch {
    if (prev) state.selectedBySession[sessionId] = prev;
    else delete state.selectedBySession[sessionId];
    emit();
    return false;
  }
  emit();
  return true;
}

/** 会话集合变化 → 剪除 selectedBySession 死 id(防 agents.json 单调增长;先例 kernel/sessionTabs.ts)。 */
export async function pruneSelectedSessions(live: ReadonlySet<string>): Promise<void> {
  const before = Object.keys(state.selectedBySession).length;
  for (const sid of Object.keys(state.selectedBySession)) {
    if (!live.has(sid)) delete state.selectedBySession[sid];
  }
  if (Object.keys(state.selectedBySession).length === before) return;
  /* 后台清理无 UI 落点:吞写盘错误,下次 sessionsChanged / 加载后再试 */
  await persistAgents().catch(() => undefined);
  emit();
}

export function selectedAgent(sessionId: string): Agent | null {
  return state.agents.find((a) => a.id === state.selectedBySession[sessionId]) ?? null;
}

/* ── composer 消费面(智能体侧;提示词侧在 promptStore.ts)── */

export function agentSuggestions(): CliSuggestion[] {
  return state.agents.map((a) => ({
    value: a.name,
    description: (a.prompt.split("\n").find((l) => l.trim())?.trim() ?? "").slice(0, 60) || undefined,
  }));
}

export function agentByName(name: string): Agent | null {
  const key = name.toLowerCase();
  return state.agents.find((a) => a.name.toLowerCase() === key) ?? null;
}

export function useAssets(): AssetsState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => snapshot,
  );
}
