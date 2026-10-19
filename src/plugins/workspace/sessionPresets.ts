/**
 * 会话预设存储(workspace 插件 · 候选4)── ~/.tmd-cli/session-presets.json
 * 单文件 + 内存单源(assets agents.json 范式):loadAssets 式启动装载一次,
 * CRUD 落盘并同步内存,坏文件回落空库不抛;外部手改不 watch,重开生效。
 * 文档形态:{version:1, presets:[{id,name,engineId,model?,prompt?}]},
 * prompt = {ref:{scope,wsId?,name}}(引 assets 提示词库三元组,消费时现读)
 * 或 {text}(内联文本);v1 无 worktree 字段。
 */

import { useSyncExternalStore } from "react";
import { ipc } from "@kernel/ipc";
import type { PromptScope } from "@plugins/assets/store";

/** 提示词库引用:三元组即身份(PromptEntry 无 id,同 promptStore 口径)。 */
export interface PresetPromptRef {
  scope: PromptScope;
  /** scope = workspace 时归属的工作区 id。 */
  wsId?: string;
  name: string;
}

export type PresetPrompt = { ref: PresetPromptRef } | { text: string };

export interface SessionPreset {
  id: string;
  name: string;
  engineId: string;
  model?: string;
  /** 范围:true = 每次在新 worktree 起会话(分支 = 预设名 slug,冲突自动递增);undefined = 当前工作区。 */
  worktree?: boolean;
  prompt?: PresetPrompt;
}

interface PresetsState {
  loaded: boolean;
  /** 读失败 ≠ 空库(权限/占用等非缺失错误):内存可读但拒绝落盘,防近空
   *  state 整本覆写真库(同 notify/wiki 的 isMissingReadErr 先例)。 */
  readBroken: boolean;
  presets: SessionPreset[];
}

const state: PresetsState = { loaded: false, readBroken: false, presets: [] };
const listeners = new Set<() => void>();
let snapshot: Omit<PresetsState, "readBroken"> = { loaded: state.loaded, presets: [...state.presets] };

function emit(): void {
  /* readBroken 是内部拒写位,不进订阅快照(视图面只关心 loaded/presets)。 */
  snapshot = { loaded: state.loaded, presets: [...state.presets] };
  for (const fn of listeners) fn();
}

/** 订阅预设变化(useSyncExternalStore 消费);返回退订函数。 */
export function subscribeSessionPresets(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSessionPresets(): Omit<PresetsState, "readBroken"> {
  /* 第三参 getServerSnapshot 同源:纯内存快照,server 渲染(测试 renderToStaticMarkup)不缺参。 */
  return useSyncExternalStore(subscribeSessionPresets, () => snapshot, () => snapshot);
}

/** 非渲染消费面的直读(测试缝;与 useSessionPresets 同一快照源)。 */
export function readSessionPresets(): Omit<PresetsState, "readBroken"> {
  return snapshot;
}

let cachedHome = "";
/** tmd 家目录(~/.tmd-cli;agents.json 同层平铺惯例,自算不引 assets 内部件)。 */
async function presetsDir(): Promise<string> {
  if (!cachedHome) cachedHome = `${await ipc.configHomeDir()}/.tmd-cli`;
  return cachedHome;
}

/* ── 磁盘文档 → 内存(白名单式 sanitize,坏形字段整条弃置;字段逐个 typeof/in 校验) ── */

function sanitizeRef(raw: unknown): PresetPromptRef | null {
  if (typeof raw !== "object" || raw === null || !("scope" in raw) || !("name" in raw)) return null;
  const { scope, name } = raw;
  if ((scope !== "global" && scope !== "workspace") || typeof name !== "string" || !name) return null;
  const wsId = "wsId" in raw ? raw.wsId : undefined;
  if (wsId !== undefined && typeof wsId !== "string") return null;
  return { scope, wsId, name };
}

function sanitizePrompt(raw: unknown): PresetPrompt | null {
  if (typeof raw !== "object" || raw === null) return null;
  const text = "text" in raw ? raw.text : undefined;
  if (typeof text === "string" && text.trim()) return { text };
  const ref = sanitizeRef("ref" in raw ? raw.ref : undefined);
  return ref ? { ref } : null;
}

function sanitizePresets(raw: unknown): SessionPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: SessionPreset[] = [];
  for (const item of raw) {
    if (
      typeof item !== "object" || item === null ||
      !("id" in item) || !("name" in item) || !("engineId" in item)
    ) {
      continue;
    }
    const { id, name, engineId } = item;
    if (typeof id !== "string" || !id) continue;
    if (typeof name !== "string" || !name.trim()) continue;
    if (typeof engineId !== "string" || !engineId) continue;
    const promptField = "prompt" in item ? item.prompt : undefined;
    /* prompt 字段存在但既非引用也非非空文本 = 坏形:整条弃置,不留语义漂移的
     * 「无提示词预设」(静默丢 prompt 会改名下启动行为,比不出现更糟)。 */
    const prompt = sanitizePrompt(promptField);
    if (promptField !== undefined && prompt === null) continue;
    const model = "model" in item ? item.model : undefined;
    out.push({
      id,
      name,
      engineId,
      model: typeof model === "string" && model.trim() ? model : undefined,
      worktree: item.worktree === true || undefined,
      prompt: prompt ?? undefined,
    });
  }
  return out;
}

/** 启动装载一次(插件 activate);缺文件/坏 JSON = 空库(agents.json 先例)。
 *  非缺失读错误 = 库不可读而非空:按空视图渲染但置 readBroken,拒写盘。 */
export async function loadSessionPresets(): Promise<void> {
  state.readBroken = false; /* 重载(测试复位/再装载)重新评估可写性 */
  let raw = "";
  try {
    raw = await ipc.fsReadFile(`${await presetsDir()}/session-presets.json`);
  } catch (e) {
    raw = ""; /* configHomeDir/fsReadFile 缺环境(测试/无 Tauri)或缺文件 = 空库,不上抛 */
    /* 同 notify/wiki 先例:非缺失读错误(EACCES/EBUSY…)≠ 空库 */
    if (!/os error [23]\b|no such file/i.test(String(e))) {
      state.readBroken = true;
      console.warn("[session-presets] 读预设库失败,本轮拒绝落盘防清库", e);
    }
  }
  let presets: SessionPreset[] = [];
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      presets = sanitizePresets(
        typeof parsed === "object" && parsed !== null && "presets" in parsed ? parsed.presets : undefined,
      );
    } catch {
      /* 坏文件 = 空库,不拖垮启动 */
    }
  }
  state.presets = presets;
  state.loaded = true;
  emit();
}

async function persist(): Promise<void> {
  if (state.readBroken) throw new Error("session-presets: 库读取失败,拒绝写盘(read-broken)");
  await ipc.fsWriteFile(
    `${await presetsDir()}/session-presets.json`,
    JSON.stringify({ version: 1, presets: state.presets }, null, 2),
  );
}

/** 新建/编辑预设(id 身份;名称大小写不敏感撞车返回 null;写盘失败回滚内存)。 */
export async function savePreset(input: {
  id?: string;
  name: string;
  engineId: string;
  model?: string;
  worktree?: boolean;
  prompt?: PresetPrompt;
}): Promise<SessionPreset | null> {
  const name = input.name.trim();
  if (!name) return null;
  if (state.presets.some((p) => p.id !== input.id && p.name.toLowerCase() === name.toLowerCase())) return null;
  const preset: SessionPreset = {
    id: input.id ?? `preset-${crypto.randomUUID().slice(0, 8)}`,
    name,
    engineId: input.engineId,
    model: input.model?.trim() || undefined,
    worktree: input.worktree || undefined,
    prompt: input.prompt,
  };
  const prev = state.presets;
  state.presets = input.id ? prev.map((p) => (p.id === input.id ? preset : p)) : [...prev, preset];
  try {
    await persist();
  } catch {
    state.presets = prev;
    return null;
  }
  emit();
  return preset;
}

/** 删除预设;写盘失败回滚内存并返回 false(未命中幂等成功)。 */
export async function deletePreset(id: string): Promise<boolean> {
  const prev = state.presets;
  const next = prev.filter((p) => p.id !== id);
  if (next.length === prev.length) return true;
  state.presets = next;
  try {
    await persist();
  } catch {
    state.presets = prev;
    return false;
  }
  emit();
  return true;
}

/* ── 消费面(纯函数,DI 可 node 测试) ── */

/** 预设的消费文本:无提示词 = "";库引用 = contentOf 现读(ref 三元组原样
 *  交解析器,scope+wsId+name 全等才命中;改名/删除/跨工作区不可见 = 空串,
 *  消费方据此灰态禁点,不猜测);内联 = 原文。contentOf 注入保纯度。 */
export function presetPromptText(
  preset: SessionPreset,
  contentOf: (ref: PresetPromptRef) => string,
): string {
  if (!preset.prompt) return "";
  if ("text" in preset.prompt) return preset.prompt.text;
  return contentOf(preset.prompt.ref);
}

/* ── 编辑态草稿(表单受控面;非组件纯类型+回填,随存储域同住) ── */

/** 表单草稿:promptMode 三态约束 ref/text 二选一。 */
export interface PresetDraft {
  name: string;
  engineId: string;
  model: string;
  /** 范围:true = 新 worktree(分支 = 预设名 slug);false = 当前工作区。 */
  worktree: boolean;
  promptMode: "none" | "ref" | "text";
  ref: PresetPromptRef | null;
  text: string;
}

/** 编辑态回填(preset = null 即新建;引擎回落首候选,候选空存禁)。 */
export function draftOf(preset: SessionPreset | null, fallbackEngineId: string): PresetDraft {
  return {
    name: preset?.name ?? "",
    engineId: preset?.engineId ?? fallbackEngineId,
    model: preset?.model ?? "",
    worktree: preset?.worktree ?? false,
    promptMode: !preset?.prompt ? "none" : "ref" in preset.prompt ? "ref" : "text",
    ref: preset?.prompt && "ref" in preset.prompt ? preset.prompt.ref : null,
    text: preset?.prompt && "text" in preset.prompt ? preset.prompt.text : "",
  };
}
