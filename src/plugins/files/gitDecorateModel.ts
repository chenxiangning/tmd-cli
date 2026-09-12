/**
 * 文件树 Git 变更着色 —— 纯函数与开关单例(自 gitDecorate.tsx 拆出,
 * only-export-components):hook 与开关按钮留在原 tsx,本文件只留
 * 「绝对路径 → 颜色类」map 逻辑与 localStorage 开关状态。
 */

import type { GitFileStatus } from "@kernel/ipc";

const STORAGE_KEY = "tmd.fileTree.gitDecorate.v1";

/* 状态字母 → 行文字色;修改=蓝、新增=深绿为用户口径(主题 token 两主题各给色),
 * 删除/冲突沿用 diff 红,rename 用琥珀与蓝区分。 */
const STATUS_COLOR: Record<GitFileStatus["status"], string> = {
  D: "text-(--tmd-diff-removed)",
  C: "text-(--tmd-diff-removed)",
  M: "text-(--tmd-git-tree-modified)",
  T: "text-(--tmd-git-tree-modified)",
  A: "text-(--tmd-git-tree-added)",
  "?": "text-(--tmd-git-tree-added)",
  R: "text-(--tmd-git-modified)",
};
/** 目录聚合优先级:含删除/冲突 > 含修改 > 含新增/未跟踪 > 仅改名。 */
const DIR_PRIORITY = [
  "text-(--tmd-diff-removed)",
  "text-(--tmd-git-tree-modified)",
  "text-(--tmd-git-tree-added)",
  "text-(--tmd-git-modified)",
];

/** 纯函数:git status 文件清单 → 绝对路径 → 颜色类(含全部祖先目录聚合)。 */
export function buildDecorationMap(
  root: string,
  files: readonly GitFileStatus[],
): ReadonlyMap<string, string> {
  const base = root.replace(/\/+$/, "");
  const map = new Map<string, string>();
  const dirRank = new Map<string, number>();
  for (const f of files) {
    const cls = STATUS_COLOR[f.status];
    if (!cls) continue;
    map.set(`${base}/${f.path}`, cls);
    const parts = f.path.split("/");
    parts.pop();
    const rank = DIR_PRIORITY.indexOf(cls);
    let cur = "";
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      const abs = `${base}/${cur}`;
      const prev = dirRank.get(abs);
      if (prev === undefined || rank < prev) dirRank.set(abs, rank);
    }
  }
  for (const [abs, rank] of dirRank) map.set(abs, DIR_PRIORITY[rank]);
  return map;
}

/** 多仓合并条目:repo 绝对根 + 该仓相对路径的 status 清单。 */
export interface RepoStatusEntry {
  root: string;
  files: readonly GitFileStatus[];
}

/** 纯函数:逐仓着色后合并(spec §4)。
 *  深度序应用(外层先、内层后)→ 内层仓覆盖外层对它的未跟踪声明;
 *  仓根目录 = 该仓聚合最高优先级色(树上一眼看出哪个仓脏);
 *  聚合不越仓界(buildDecorationMap 祖先止步于仓根)。 */
export function mergeRepoStatusDecorations(
  entries: readonly RepoStatusEntry[],
): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  const sorted = [...entries].sort((a, b) => (a.root < b.root ? -1 : a.root > b.root ? 1 : 0));
  for (const e of sorted) {
    const m = buildDecorationMap(e.root, e.files);
    let bestRank = -1;
    for (const cls of m.values()) {
      const rank = DIR_PRIORITY.indexOf(cls);
      if (rank >= 0 && (bestRank < 0 || rank < bestRank)) bestRank = rank;
    }
    for (const [k, v] of m) out.set(k, v);
    if (bestRank >= 0) out.set(e.root.replace(/\/+$/, ""), DIR_PRIORITY[bestRank]);
  }
  return out;
}

/* ── 开关(模块级单例;localStorage 持久化,对齐 filePanel 钉住惯例)── */

function loadEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false; // 无 Web Storage(node 测试环境)
  }
}

let enabled = loadEnabled();
const listeners = new Set<() => void>();

export function isGitDecorateEnabled(): boolean {
  return enabled;
}

export function toggleGitDecorate(): void {
  enabled = !enabled;
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* 持久化失败不碍本次会话 */
  }
  for (const l of listeners) l();
}

/** useSyncExternalStore 订阅口(hook 与开关按钮共用)。 */
export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
