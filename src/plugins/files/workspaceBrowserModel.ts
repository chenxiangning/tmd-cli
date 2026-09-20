/**
 * 侧栏工作区文件浏览器 —— 侧栏特有的纯逻辑(忽略降显 / 变更剪枝 / 文件名搜索)。
 * git 状态着色与字母标记复用 gitDecorateModel(右栏同源);目录浏览状态复用
 * useDirTree(右栏同源);本文件只放右侧没有的交互语义。
 */

import {
  buildDecorationMap,
  mergeRepoStatusDecorations,
  type RepoStatusEntry,
} from "./gitDecorateModel";
import type { GitFileStatus } from "@kernel/ipc";

/** 忽略降显:路径自身或任一祖先命中前缀(或为 .git)即忽略。
 *  prefixes 为绝对路径口径(Rust 返回仓相对,调用方先拼 root)。 */
export function isIgnoredPath(path: string, prefixes: readonly string[]): boolean {
  const p = path.replace(/\/+$/, "");
  if (p.split("/").includes(".git")) return true;
  for (const prefix of prefixes) {
    const pre = prefix.replace(/\/+$/, "");
    if (pre && (p === pre || p.startsWith(`${pre}/`))) return true;
  }
  return false;
}

/** 变更剪枝树子条目(目录不带尾斜杠的绝对路径)。 */
export interface ChangedChild {
  name: string;
  path: string;
  isDir: boolean;
}

/** 变更剪枝树:git status 文件清单 → absDir → 有序直接子条目(目录在前,
 *  同层名称升序);目录条目 = 变更文件的祖先链;根键为 root 本身。
 *  漏斗开(仅显示有变更的文件)时的列表数据源,零额外 IPC。 */
export function buildChangedChildren(
  root: string,
  files: readonly GitFileStatus[],
): ReadonlyMap<string, readonly ChangedChild[]> {
  const base = root.replace(/\/+$/, "");
  const buckets = new Map<string, Map<string, ChangedChild>>();
  const bucketOf = (absDir: string) => {
    let m = buckets.get(absDir);
    if (!m) {
      m = new Map();
      buckets.set(absDir, m);
    }
    return m;
  };
  for (const f of files) {
    /* 尾斜杠 = status 折叠的整目录变更(如嵌套仓 untracked):按目录叶子入树,
     * 其子项状态未知 —— 空桶,可展开性由子项数决定(视图侧守卫)。 */
    const dirLeaf = f.path.endsWith("/");
    const parts = f.path.replace(/\/+$/, "").split("/");
    let cur = base;
    for (let i = 0; i < parts.length; i++) {
      const abs = `${cur}/${parts[i]}`;
      if (i < parts.length - 1) {
        const bucket = bucketOf(cur);
        if (!bucket.has(parts[i])) {
          bucket.set(parts[i], { name: parts[i], path: abs, isDir: true });
        }
        cur = abs;
      } else {
        bucketOf(cur).set(parts[i], { name: parts[i], path: abs, isDir: dirLeaf });
        if (dirLeaf) bucketOf(abs);
      }
    }
  }
  const out = new Map<string, readonly ChangedChild[]>();
  for (const [absDir, bucket] of buckets) {
    out.set(
      absDir,
      [...bucket.values()].sort((a, b) =>
        a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name),
      ),
    );
  }
  return out;
}

/** 搜索命中:fs_walk_files 相对路径按文件名子串过滤(大小写不敏感)→ 绝对路径。 */
export function filterWalkHits(root: string, relPaths: readonly string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const base = root.replace(/\/+$/, "");
  const out: string[] = [];
  for (const rel of relPaths) {
    const name = rel.split("/").pop() ?? rel;
    if (name.toLowerCase().includes(q)) out.push(`${base}/${rel}`);
  }
  return out;
}

/* ── 组合派生(侧栏浏览器视图消费;着色复用 gitDecorateModel 纯函数)── */

const EMPTY_COLORS: ReadonlyMap<string, string> = new Map();

/** 派生:逐仓 status → 着色表(单仓不掺仓根聚合,口径同右栏 useGitDecorations)。 */
export function decorationColors(
  root: string,
  entries: readonly RepoStatusEntry[] | null,
  single: boolean,
): ReadonlyMap<string, string> {
  if (!entries) return EMPTY_COLORS;
  if (single) return buildDecorationMap(root, entries[0]?.files ?? []);
  return mergeRepoStatusDecorations(entries);
}

/** 派生:变更剪枝树(逐仓构建后合并桶)。 */
export function changedTreeOf(
  statusEntries: readonly RepoStatusEntry[] | null,
): ReadonlyMap<string, readonly ChangedChild[]> {
  const out = new Map<string, readonly ChangedChild[]>();
  for (const e of statusEntries ?? []) {
    for (const [k, v] of buildChangedChildren(e.root, e.files)) out.set(k, v);
  }
  return out;
}

/** 派生:变更态根层条目(多仓根合成 —— root 非仓时各仓根目录露出)。 */
export function changedRootChildren(
  base: string,
  changedTree: ReadonlyMap<string, readonly ChangedChild[]>,
  statusEntries: readonly RepoStatusEntry[] | null,
): readonly ChangedChild[] {
  const kids = new Map<string, ChangedChild>();
  for (const c of changedTree.get(base) ?? []) kids.set(c.path, c);
  for (const e of statusEntries ?? []) {
    const repo = e.root.replace(/\/+$/, "");
    /* 仅抬一层:更深的嵌套仓留在其父目录的变更祖先链里,避免根层重复露出 */
    const rel = repo.startsWith(`${base}/`) ? repo.slice(base.length + 1) : "";
    if (repo !== base && rel && !rel.includes("/")) {
      kids.set(repo, { name: rel, path: repo, isDir: true });
    }
  }
  return [...kids.values()].sort((a, b) =>
    a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name),
  );
}
