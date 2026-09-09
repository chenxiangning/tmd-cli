/**
 * 提示词库存储 —— 两级 md 目录 CRUD + composer 消费面(只读内存)。
 *
 * 与 store.ts 同一内存单源:state / emit / tmdHome 由 store.ts 以插件内共享名义导出,
 * 本文件直接消费(拆分动因 = 文件规模铁则;磁盘布局与加载契约见 store.ts 头注释)。
 */

import type { CliSuggestion } from "@kernel/cli";
import { ipc } from "@kernel/ipc";
import { getWorkspaces } from "@kernel/workspace";
import { isValidPromptName, serializePromptFile } from "./promptMd";
import { emit, state, tmdHome, type PromptEntry, type PromptScope } from "./store";

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

/** 新建/编辑提示词(改名 = 写新文件 + 旧文件进废纸篓);非法名称 / 同作用域撞名 / 写盘失败返回 false。 */
export async function savePrompt(
  scope: PromptScope,
  wsId: string | undefined,
  data: { name: string; description?: string; argumentHint?: string; content: string },
  oldName?: string,
): Promise<boolean> {
  const name = data.name.trim();
  if (!isValidPromptName(name)) return false;
  if (
    state.prompts.some(
      (p) => p.scope === scope && p.wsId === wsId && p.name !== oldName && p.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    return false;
  }
  const dir = await ensurePromptDir(scope, wsId);
  try {
    await ipc.fsWriteFile(`${dir}/${name}.md`, serializePromptFile(data));
    if (oldName && oldName !== name) await ipc.fsTrashEntry(`${dir}/${oldName}.md`).catch(() => undefined);
  } catch {
    return false;
  }
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

/** 可见提示词:工作区级(当前 cwd 所属工作区)在前、全局在后;同名工作区覆盖全局。 */
function visiblePrompts(cwd: string): PromptEntry[] {
  const wsId = getWorkspaces().find((w) => w.root === cwd)?.id ?? null;
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
