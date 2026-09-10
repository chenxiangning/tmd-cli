/**
 * 文件树 Git 变更着色 —— subbar 开关按钮 + 「绝对路径 → 颜色类」map。
 *
 * 数据自取 ipc.gitStatus(kernel IPC 通用传输,不跨插件 import);
 * 开关关闭时零轮询零计算。开启时 5s 轮询对齐 git 插件 useGitStatus 策略
 * (失焦暂停);map 内容不变不换引用,防空转重渲染。
 * 目录色 = 子孙变更聚合取优先级最高(红 > 蓝 > 深绿 > 琥珀),参考 VS Code。
 * map 逻辑与开关单例拆至 gitDecorateModel.ts(only-export-components)。
 */
import { useEffect, useState, useSyncExternalStore } from "react";
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
      aria-label={t("按 Git 变更着色文件")}
      aria-pressed={on}
      title={on ? t("关闭 Git 变更着色") : t("按 Git 变更着色文件与文件夹")}
      onClick={toggleGitDecorate}
    >
      <GitDiff size="0.75rem" aria-hidden />
    </button>
  );
}
