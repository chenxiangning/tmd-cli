/**
 * 文件树 Git 变更着色 —— 工具条开关按钮 + 「绝对路径 → 颜色类」map。
 *
 * 数据自取 ipc.gitStatus(kernel IPC 通用传输,不跨插件 import);
 * 开关关闭时零轮询零计算。开启时 5s 轮询对齐 git 插件 useGitStatus 策略
 * (失焦暂停);map 内容不变不换引用,防空转重渲染。
 * 目录色 = 子孙变更聚合取优先级最高(红 > 蓝 > 深绿 > 琥珀),参考 VS Code。
 * map 逻辑与开关单例拆至 gitDecorateModel.ts(only-export-components)。
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { usePanelActive } from "@kernel/panelActivity";
import { GitDiff } from "@phosphor-icons/react";
import { ipc, type GitRepoSummary } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import {
  buildDecorationMap,
  isGitDecorateEnabled,
  mergeRepoStatusDecorations,
  subscribe,
  toggleGitDecorate,
  type RepoStatusEntry,
} from "./gitDecorateModel";

const POLL_MS = 5000;

function sameMap(
  a: ReadonlyMap<string, string>,
  b: ReadonlyMap<string, string>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

const EMPTY: ReadonlyMap<string, string> = new Map();

const SLOW_POLL_MS = 60_000;

/** git status 原始数据面(发现 + 逐仓状态轮询)—— 右栏着色与侧栏工作区文件
 *  浏览器共用一条管线:on=false 零轮询;发现未决/失败 = 单仓兜底(single)。
 *  轮询 5s、发现巡航 60s,均失焦暂停(对齐 git 插件 useGitStatus 策略)。 */
export function useRepoStatusState(
  root: string,
  on: boolean,
): {
  repos: GitRepoSummary[] | null;
  /** 成功取回的逐仓 status(null = 尚无结果;空数组 = 非仓/全部失败)。 */
  entries: RepoStatusEntry[] | null;
  /** 走单仓路径(发现未决/失败,或 root 自身即唯一仓)—— 回归红线:与旧
   *  实现一致,单仓不掺仓根聚合色。 */
  single: boolean;
} {
  const panelActive = usePanelActive();
  const [repos, setRepos] = useState<GitRepoSummary[] | null>(null);
  const [entries, setEntries] = useState<RepoStatusEntry[] | null>(null);

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
      if (panelActive && document.visibilityState === "visible") scan();
    }, SLOW_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [on, root, panelActive]);

  const single = repos == null || (repos.length === 1 && repos[0].path === root);
  useEffect(() => {
    if (!on || !root) {
      setEntries(null);
      return;
    }
    let alive = true;
    const apply = (next: RepoStatusEntry[] | null) =>
      setEntries((prev) => (sameEntries(prev, next) ? prev : next));
    const fetch = () => {
      if (single) {
        ipc.gitStatus(root).then(
          (s) => {
            /* files 形状防御:非数组按无变更处理 —— 着色纯函数 for..of 遇 undefined
             * 会抛,贡献组件三崩即熔断 files 插件,文件树/渲染整面消失(会话内
             * 不自愈,重启才恢复)。数据面异常不应升级为插件死亡。 */
            if (alive) apply([{ root, files: Array.isArray(s?.files) ? s.files : [] }]);
          },
          () => {
            if (alive) apply([]); // 非仓库等错误 = 无变更数据,不扰树
          },
        );
        return;
      }
      const list = repos!;
      void ipc.gitStatusBatch(list.map((r) => r.path)).then(
        (rows) => {
          if (!alive) return;
          const next: RepoStatusEntry[] = [];
          for (const row of rows) {
            const files = row?.status?.files;
            if (Array.isArray(files)) next.push({ root: row.root, files });
          }
          apply(next); /* 失败仓 Rust 侧已省略,单批失败(非仓)整体空集 */
        },
        () => {
          if (alive) apply([]);
        },
      );
    };
    void fetch();
    const id = window.setInterval(() => {
      if (panelActive && document.visibilityState === "visible") fetch();
    }, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [on, root, repos, single, panelActive]);

  return { repos, entries, single };
}

/** 状态数据等价判定:root + 逐文件 path/status 逐项相等(map 派生面只消费这两维)。 */
function sameEntries(
  a: readonly RepoStatusEntry[] | null,
  b: readonly RepoStatusEntry[] | null,
): boolean {
  if (a === b) return true;
  if (a == null || b == null || a.length !== b.length) return false;
  return a.every((e, i) => {
    const o = b[i]!;
    return (
      e.root === o.root &&
      e.files.length === o.files.length &&
      e.files.every((f, j) => f.path === o.files[j]!.path && f.status === o.files[j]!.status)
    );
  });
}

/** 开启时轮询 git status,返回 绝对路径 → 颜色类;关闭时恒空 map(零副作用)。
 *  数据面见 useRepoStatusState;单仓(仅 root)保持旧路径输出 —— 与旧实现
 *  逐项一致(回归红线,不掺仓根聚合色);多仓走 Rust 批量
 *  git_status_batch(2026-10-06 落地:N 次 invoke → 1 次往返)。 */
export function useGitDecorations(root: string): ReadonlyMap<string, string> {
  const on = useSyncExternalStore(subscribe, isGitDecorateEnabled);
  const { entries, single } = useRepoStatusState(root, on);
  const [colors, setColors] = useState<ReadonlyMap<string, string>>(EMPTY);
  useEffect(() => {
    if (!on || !entries) {
      setColors(EMPTY);
      return;
    }
    const next =
      single && entries[0]?.root !== root
        ? EMPTY // 发现态切换的单拍撕裂窗口:宁空勿错色(自愈于下一轮 fetch)
        : single
          ? buildDecorationMap(root, entries[0]?.files ?? [])
          : entries.length
            ? mergeRepoStatusDecorations(entries)
            : EMPTY;
    setColors((prev) => (sameMap(prev, next) ? prev : next));
  }, [on, root, entries, single]);
  return on ? colors : EMPTY;
}

/** 忽略前缀(绝对口径):单仓 root / 多仓逐仓按各仓根拼接 —— 嵌套仓各自
 *  ignore 并入(2026-10-06,替换「仅 root 仓」旧口径);非仓/失败 = 空集。
 *  WorkspaceFileBrowser 降显用(挂载/手动刷新拉取,低频无轮询)。 */
export function useIgnoredPrefixes(
  root: string,
  tick: number,
  single: boolean,
  repos: GitRepoSummary[] | null,
): string[] {
  const base = root.replace(/\/+$/, "");
  const [ignored, setIgnored] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    if (single) {
      ipc.gitIgnoredPrefixes(root).then(
        (out) => { if (alive) setIgnored(out.map((p) => `${base}/${p}`)); },
        () => { if (alive) setIgnored([]); },
      );
    } else {
      const list = repos ?? [];
      void Promise.allSettled(list.map((r) => ipc.gitIgnoredPrefixes(r.path))).then((rows) => {
        if (!alive) return;
        const next: string[] = [];
        list.forEach((r, i) => {
          const row = rows[i];
          const rb = r.path.replace(/\/+$/, "");
          if (row.status === "fulfilled") next.push(...row.value.map((p: string) => `${rb}/${p}`));
        });
        setIgnored(next);
      });
    }
    return () => { alive = false; };
  }, [root, base, tick, repos, single]);
  return ignored;
}

/** 文件树工具条开关按钮(FileTreeToolbar 内联渲染;2026-10-02 自外壳 actions 槽收编)。 */
export function GitDecorateToggle() {
  const on = useSyncExternalStore(subscribe, isGitDecorateEnabled);
  return (
    <button
      type="button"
      className={`file-tree-toolbar-action${on ? " is-active" : ""}`}
      aria-label={t("按 Git 变更着色文件")}
      aria-pressed={on}
      data-action-id="files-git-toggle"
      title={on ? t("关闭 Git 变更着色") : t("按 Git 变更着色文件与文件夹")}
      onClick={toggleGitDecorate}
    >
      {/* 两态双图标:选中(着色中)实心,未选中线性;着色规则 = 选中才吃装饰色 */}
      <GitDiff size="0.75rem" weight={on ? "fill" : "regular"} aria-hidden />
    </button>
  );
}
