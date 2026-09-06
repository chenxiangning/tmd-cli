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
import { ipc, type GitFileStatus } from "@kernel/ipc";

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

/** 开启时轮询 git status,返回 绝对路径 → 颜色类;关闭时恒空 map(零副作用)。 */
export function useGitDecorations(root: string): ReadonlyMap<string, string> {
  const on = useSyncExternalStore(subscribe, isGitDecorateEnabled);
  const [colors, setColors] = useState<ReadonlyMap<string, string>>(EMPTY);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    const fetch = () => {
      ipc.gitStatus(root).then(
        (s) => {
          if (!alive) return;
          const next = buildDecorationMap(root, s.files);
          setColors((prev) => (sameMap(prev, next) ? prev : next));
        },
        () => {
          if (alive) setColors(EMPTY); // 非仓库等错误 = 无着色,不扰树
        },
      );
    };
    void fetch();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") fetch();
    }, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [on, root]);
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
