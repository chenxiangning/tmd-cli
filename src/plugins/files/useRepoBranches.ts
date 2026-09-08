/**
 * useRepoBranches —— 文件树仓根行的分支标注(spec 2026-09-07-git-multi-repo-design §4)。
 * 数据自取(禁跨插件 import,与 git 插件 useGitRepos 同款纪律):
 * root 下 gitReposScan(深度 2)60s 慢巡航,仓路径 → 标注文案。
 * 标注 = 分支名;submodule/worktree 前置类型;detached/unborn 无分支不标注。
 */

import { useEffect, useState } from "react";
import { ipc, type GitRepoSummary } from "@kernel/ipc";
import { t } from "@kernel/i18n";

const SLOW_POLL_MS = 60_000;

/* 禁跨插件 import:与 git 插件 RepoBar.KIND_META 同值互指(标签文案变更双侧同步)。 */
const KIND_LABEL: Record<GitRepoSummary["kind"], string | null> = {
  repo: null,
  submodule: "子模块",
  worktree: "工作树",
};

export function useRepoBranches(root: string): ReadonlyMap<string, string> {
  const [tags, setTags] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    if (!root) {
      setTags(new Map());
      return;
    }
    let alive = true;
    const scan = () => {
      ipc.gitReposScan(root, 2).then(
        (out) => {
          if (!alive) return;
          const next = new Map<string, string>();
          for (const r of out.repos) {
            const kind = KIND_LABEL[r.kind];
            const tag = [kind != null ? t(kind) : null, r.branch].filter((s): s is string => s != null && s !== "").join(" · ");
            if (tag) next.set(r.path, tag);
          }
          setTags((prev) => (prev.size === next.size && [...prev].every(([k, v]) => next.get(k) === v) ? prev : next));
        },
        () => {
          if (alive) setTags((prev) => (prev.size === 0 ? prev : new Map()));
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
  }, [root]);
  return tags;
}
