/**
 * 文件树 Git 变更着色 —— subbar 开关按钮 + 「绝对路径 → 颜色类」map。
 *
 * 数据自取 ipc.gitStatus(kernel IPC 通用传输,不跨插件 import);
 * 开关关闭时零轮询零计算。开启时 5s 轮询对齐 git 插件 useGitStatus 策略
 * (失焦暂停);map 内容不变不换引用,防空转重渲染。
 * 目录色 = 子孙变更聚合取优先级最高(红 > 蓝 > 深绿 > 琥珀),参考 VS Code。
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { GitDiff } from "@phosphor-icons/react";
import { ipc, type GitFileStatus, type GitRepoSummary } from "@kernel/ipc";

const STORAGE_KEY = "tmd.fileTree.gitDecorate.v1";
const POLL_MS = 5000;

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

function sameMap(
  a: ReadonlyMap<string, string>,
  b: ReadonlyMap<string, string>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
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

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const EMPTY: ReadonlyMap<string, string> = new Map();

const SLOW_POLL_MS = 60_000;

/** 开启时轮询 git status,返回 绝对路径 → 颜色类;关闭时恒空 map(零副作用)。
 *  多仓(spec §4):发现走 60s 慢巡航;单仓(仅 root)保持现状路径 —— 输出与
 *  旧实现逐项一致(回归红线,不掺仓根聚合色);多仓/非仓根逐仓并行后合并。
 *  ponytail: N > 10 后正确升级是 Rust 批量 status,换数据源即可,map 逻辑不变。 */
export function useGitDecorations(root: string): ReadonlyMap<string, string> {
  const on = useSyncExternalStore(subscribe, isGitDecorateEnabled);
  const [repos, setRepos] = useState<GitRepoSummary[] | null>(null);
  const [colors, setColors] = useState<ReadonlyMap<string, string>>(EMPTY);

  // 发现:root 切换 + 60s 慢巡航(与 git 插件 useGitRepos 各自自取,禁跨插件 import)
  useEffect(() => {
    if (!on || !root) {
      setRepos(null);
      return;
    }
    let alive = true;
    const scan = () => {
      ipc.gitReposScan(root, 2).then(
        (out) => {
          if (alive) setRepos(out.repos);
        },
        () => {
          if (alive) setRepos(null); // 发现失败 = 按单仓路径兜底
        },
      );
    };
    scan();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") scan();
    }, SLOW_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [on, root]);

  const isPlainSingle = repos != null && repos.length === 1 && repos[0].path === root;
  useEffect(() => {
    if (!on || !root) {
      setColors(EMPTY);
      return;
    }
    let alive = true;
    const apply = (next: ReadonlyMap<string, string>) =>
      setColors((prev) => (sameMap(prev, next) ? prev : next));
    const fetch = () => {
      if (repos == null || isPlainSingle) {
        ipc.gitStatus(root).then(
          (s) => {
            if (alive) apply(buildDecorationMap(root, s.files));
          },
          () => {
            if (alive) apply(EMPTY); // 非仓库等错误 = 无着色,不扰树
          },
        );
        return;
      }
      void Promise.allSettled(repos.map((r) => ipc.gitStatus(r.path))).then((rows) => {
        if (!alive) return;
        const entries: RepoStatusEntry[] = [];
        repos.forEach((r, i) => {
          const row = rows[i];
          if (row.status === "fulfilled") entries.push({ root: r.path, files: row.value.files });
        });
        apply(entries.length ? mergeRepoStatusDecorations(entries) : EMPTY);
      });
    };
    void fetch();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") fetch();
    }, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [on, root, repos, isPlainSingle]);
  return on ? colors : EMPTY;
}

/** subbar 开关按钮(经 FilePanelContribution.actions 槽进外壳)。 */
export function GitDecorateToggle() {
  const on = useSyncExternalStore(subscribe, isGitDecorateEnabled);
  return (
    <button
      type="button"
      className={`panel-subbar-action${on ? " is-active" : ""}`}
      aria-label="按 Git 变更着色文件"
      aria-pressed={on}
      title={on ? "关闭 Git 变更着色" : "按 Git 变更着色文件与文件夹"}
      onClick={toggleGitDecorate}
    >
      <GitDiff size={12} aria-hidden />
    </button>
  );
}
