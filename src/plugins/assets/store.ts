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
 */

import { useSyncExternalStore } from "react";
import type { CliSuggestion } from "@kernel/cli";
import { ipc } from "@kernel/ipc";
import { getWorkspaces, workspacesReady } from "@kernel/workspace";
import { parsePromptFile, serializePromptFile } from "./promptMd";

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

export interface AssetsState {
  loaded: boolean;
  agents: Agent[];
  prompts: PromptEntry[];
  selectedBySession: Record<string, string>;
}

const state: AssetsState = { loaded: false, agents: [], prompts: [], selectedBySession: {} };
const listeners = new Set<() => void>();
let snapshot: AssetsState = state;

function emit(): void {
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
async function tmdHome(): Promise<string> {
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

/** 新建/编辑智能体;名称(大小写不敏感)撞车返回 null。 */
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
  state.agents = [...state.agents.filter((a) => a.id !== agent.id), agent].sort(
    (a, b) => a.createdAt - b.createdAt,
  );
  await persistAgents().catch(() => undefined);
  emit();
  return agent;
}

export async function deleteAgent(id: string): Promise<void> {
  state.agents = state.agents.filter((a) => a.id !== id);
  for (const [sid, aid] of Object.entries(state.selectedBySession)) {
    if (aid === id) delete state.selectedBySession[sid];
  }
  await persistAgents().catch(() => undefined);
  emit();
}

/** 会话级智能体选择(持久化进 agents.json);null = 取消。 */
export async function selectAgent(sessionId: string, agentId: string | null): Promise<void> {
  if (agentId) state.selectedBySession[sessionId] = agentId;
  else delete state.selectedBySession[sessionId];
  await persistAgents().catch(() => undefined);
  emit();
}

export function selectedAgent(sessionId: string): Agent | null {
  return state.agents.find((a) => a.id === state.selectedBySession[sessionId]) ?? null;
}

/* ── 提示词 CRUD + 作用域移动 ── */

/** 文件名即显示名:禁路径分隔符与控制字符,trim 后为空 = 非法。 */
export function sanitizePromptName(name: string): string {
  return name.replace(/[/\\\u0000-\u001f]/g, "").trim();
}

async function ensurePromptDir(scope: PromptScope, wsId: string | undefined): Promise<string> {
  const base = await tmdHome();
  /* fsCreateDir 撞已存在即报错 = 幂等;失败忽略,写文件时自然会再暴露 */
  if (scope === "workspace") {
    await ipc.fsCreateDir(`${base}/workspaces`).catch(() => undefined);
    await ipc.fsCreateDir(`${base}/workspaces/${wsId}`).catch(() => undefined);
  }
  const dir = scope === "global" ? `${base}/prompts` : `${base}/workspaces/${wsId}/prompts`;
  await ipc.fsCreateDir(dir).catch(() => undefined);
  return dir;
}

/** 新建/编辑提示词(改名 = 写新文件 + 旧文件进废纸篓);同作用域撞名返回 false。 */
export async function savePrompt(
  scope: PromptScope,
  wsId: string | undefined,
  data: { name: string; description?: string; argumentHint?: string; content: string },
  oldName?: string,
): Promise<boolean> {
  const name = sanitizePromptName(data.name);
  if (!name) return false;
  if (
    state.prompts.some(
      (p) => p.scope === scope && p.wsId === wsId && p.name !== oldName && p.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    return false;
  }
  const dir = await ensurePromptDir(scope, wsId);
  await ipc.fsWriteFile(`${dir}/${name}.md`, serializePromptFile(data));
  if (oldName && oldName !== name) await ipc.fsTrashEntry(`${dir}/${oldName}.md`).catch(() => undefined);
  state.prompts = state.prompts.filter(
    (p) => !(p.scope === scope && p.wsId === wsId && (p.name === name || p.name === oldName)),
  );
  state.prompts.push({
    name,
    scope,
    wsId,
    description: data.description,
    argumentHint: data.argumentHint,
    content: data.content,
  });
  emit();
  return true;
}

export async function deletePrompt(entry: PromptEntry): Promise<void> {
  const dir = await ensurePromptDir(entry.scope, entry.wsId);
  await ipc.fsTrashEntry(`${dir}/${entry.name}.md`).catch(() => undefined);
  /* 按身份字段(scope + wsId + name)匹配,不依赖调用方传来的就是内存里同一对象 */
  state.prompts = state.prompts.filter(
    (p) => !(p.scope === entry.scope && p.wsId === entry.wsId && p.name === entry.name),
  );
  emit();
}

/** 移到对侧作用域(目标工作区 = wsId 参数);撞名返回 false 不动。 */
export async function movePrompt(entry: PromptEntry, target: PromptScope, targetWsId?: string): Promise<boolean> {
  const moved = await savePrompt(target, target === "workspace" ? targetWsId : undefined, entry);
  if (!moved) return false;
  await deletePrompt(entry);
  return true;
}

/* ── composer 消费面(只读内存) ── */

function wsIdForCwd(cwd: string): string | null {
  return getWorkspaces().find((w) => w.root === cwd)?.id ?? null;
}

/** 可见提示词:工作区级(当前 cwd 所属工作区)在前、全局在后;同名工作区覆盖全局。 */
function visiblePrompts(cwd: string): PromptEntry[] {
  const wsId = wsIdForCwd(cwd);
  const seen = new Set<string>();
  const out: PromptEntry[] = [];
  const ordered = [...state.prompts].sort(
    (a, b) => (a.scope === "workspace" ? 0 : 1) - (b.scope === "workspace" ? 0 : 1) || a.name.localeCompare(b.name),
  );
  for (const p of ordered) {
    if (p.scope === "workspace" && p.wsId !== wsId) continue;
    const key = p.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

export function promptSuggestions(cwd: string): CliSuggestion[] {
  return visiblePrompts(cwd).map((p) => ({
    value: p.name,
    description: [p.description, p.argumentHint ? `参数: ${p.argumentHint}` : ""]
      .filter(Boolean)
      .join(" · ") || undefined,
  }));
}

/** insertText 解析:与 promptSuggestions 同一份可见性/覆盖规则,按名取正文。 */
export function promptContent(name: string, cwd: string): string {
  const key = name.toLowerCase();
  return visiblePrompts(cwd).find((p) => p.name.toLowerCase() === key)?.content ?? "";
}

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
