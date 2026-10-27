/**
 * 插件私有持久化 —— configDir()/tmd-lint.json(prompt-enhancer/enhanceStore.ts
 * 同款先例:configDir() 即 ~/.tmd-cli,布局 owner 是 Rust session.rs,插件不自拼;
 * 曾误用 configHomeDir 自拼 ~/.config/tmd-cli/,已拍板指纹与缓存全部写丢,已纠)。
 *
 * 存三样:引擎/模型 lastUsed、已拍板指纹(此前处理过的规则不再重复报,
 * 移植 tmd-lint handled.json,但存 app 侧不污染仓库)、上次体检结果缓存
 * (面板重开不丢)。损坏静默重置;写盘串行化防乱序。
 */

import { ipc } from "@kernel/ipc";
import type { LintRow, LintTarget, StaticFinding } from "./lintTypes";

export interface LintStoreData {
  lastUsed: { engineId: string; model: string } | null;
  handled: string[];
  lastResult: {
    at: number;
    cwd: string;
    targets: LintTarget[];
    rows: LintRow[];
    findings: StaticFinding[];
  } | null;
}

const EMPTY: LintStoreData = { lastUsed: null, handled: [], lastResult: null };

let data: LintStoreData | null = null;
let writing = Promise.resolve();

export function storePath(dir: string): string {
  return `${dir}/tmd-lint.json`;
}

async function loadOnce(): Promise<LintStoreData> {
  if (data) return data;
  const dir = await ipc.configDir().catch(() => "");
  if (!dir) {
    data = { ...EMPTY };
    return data;
  }
  try {
    const raw = await ipc.fsReadFile(storePath(dir));
    const parsed = JSON.parse(raw) as Partial<LintStoreData>;
    data = {
      lastUsed: parsed.lastUsed ?? null,
      handled: Array.isArray(parsed.handled) ? parsed.handled : [],
      lastResult: parsed.lastResult ?? null,
    };
  } catch {
    data = { ...EMPTY };
  }
  return data;
}

async function persist(): Promise<void> {
  const dir = await ipc.configDir().catch(() => "");
  if (!dir || !data) return;
  const step = ipc.fsWriteFile(storePath(dir), JSON.stringify(data)).then(() => undefined);
  writing = writing.then(() => step);
  await step;
}

export async function loadStore(): Promise<LintStoreData> {
  return loadOnce();
}

export async function setLastUsed(engineId: string, model: string): Promise<void> {
  const d = await loadOnce();
  d.lastUsed = { engineId, model };
  await persist();
}

/** 已拍板指纹追加(重复忽略);settled 态不再重复报的本地记忆。 */
export async function addHandled(sigs: string[]): Promise<void> {
  if (sigs.length === 0) return;
  const d = await loadOnce();
  d.handled = [...new Set([...d.handled, ...sigs])];
  await persist();
}

/** 单条重开(下次体检重新上报)。 */
export async function removeHandled(sig: string): Promise<void> {
  const d = await loadOnce();
  d.handled = d.handled.filter((s) => s !== sig);
  await persist();
}

export async function saveLastResult(result: LintStoreData["lastResult"]): Promise<void> {
  const d = await loadOnce();
  d.lastResult = result;
  await persist();
}

/** 仅供测试复位内存态。 */
export function resetStoreForTest(): void {
  data = null;
  void writing;
}
