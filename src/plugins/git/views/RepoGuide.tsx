/**
 * RepoGuide —— 非仓根发现引导(spec 2026-09-07-git-multi-repo-design §3,原型 orphan 场景)。
 * workspace root 非仓但扫描到子仓时,替代「当前目录不是 Git 仓库」空态:
 * 点击任一仓即以该仓为语境进入完整 Git 面板(选中态存 panelStore,按工作区记忆)。
 */

import { t } from "@kernel/i18n";
import type { GitRepoSummary } from "@kernel/ipc";
import { GitBranch } from "@phosphor-icons/react";
import { useRepoChips } from "../hooks/useRepoChips";
import { SCAN_DEPTH } from "../hooks/useGitRepos";
import { KIND_META } from "./RepoBar";

export function RepoGuide({
  root,
  repos,
  truncated,
  onSelect,
}: {
  root: string;
  repos: GitRepoSummary[];
  truncated: boolean;
  onSelect: (path: string) => void;
}) {
  const chips = useRepoChips(repos, 0);
  return (
    <div className="flex h-full min-h-0 flex-col text-xs">
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="mb-2 rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) px-3 py-2.5">
          <div className="mb-1 flex items-center gap-1.5 font-semibold">
            <GitBranch size="0.875rem" className="text-(--tmd-fg-muted)" aria-hidden />
            {t("工作区根不是 Git 仓库")}
          </div>
          <div className="leading-relaxed text-(--tmd-fg-muted)">
            {t("扫描 {root}(深度 {depth})发现 {count} 个仓库。点击任一仓库,即以该仓为语境使用完整 Git 面板。", {
              root,
              depth: SCAN_DEPTH,
              count: repos.length,
            })}
          </div>
        </div>
        {repos.map((r) => {
          const chip = chips.get(r.path);
          const dirty = chip?.dirty ?? -1;
          const kind = KIND_META[r.kind].label;
          return (
            <button
              key={r.path}
              type="button"
              title={r.path}
              onClick={() => onSelect(r.path)}
              className="group flex h-[30px] w-full items-center gap-2 rounded-sm px-2.5 text-left text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  dirty > 0 ? "bg-(--tmd-git-modified)" : "bg-(--tmd-fg-faint)"
                }`}
                aria-hidden
              />
              <span className="shrink-0 font-semibold text-(--tmd-fg)">{r.name}</span>
              <span className="shrink-0 font-mono text-[0.6875rem] text-(--tmd-fg-subtle)">
                {chip?.branch || r.branch || "—"}
              </span>
              {kind && (
                <span className="shrink-0 rounded border border-(--tmd-border) px-1 text-[0.59375rem] text-(--tmd-fg-faint)">
                  {t(kind)}
                </span>
              )}
              <span className="min-w-0 flex-1" />
              {dirty > 0 && (
                <span className="shrink-0 text-[0.6875rem] tabular-nums text-(--tmd-git-modified)">
                  {t("{n} 个变更", { n: dirty })}
                </span>
              )}
              {chip && chip.ahead > 0 && (
                <span className="shrink-0 text-[0.6875rem] tabular-nums text-(--tmd-diff-inserted)">
                  ↑{chip.ahead}
                </span>
              )}
              {chip && chip.behind > 0 && (
                <span className="shrink-0 text-[0.6875rem] tabular-nums text-(--tmd-diff-removed)">
                  ↓{chip.behind}
                </span>
              )}
              <span className="shrink-0 text-[0.65625rem] text-(--tmd-accent) opacity-0 transition-opacity group-hover:opacity-100">
                {t("进入 →")}
              </span>
            </button>
          );
        })}
      </div>
      <div className="shrink-0 border-t border-(--tmd-border) px-2.5 py-2 text-[0.65625rem] leading-relaxed text-(--tmd-fg-faint)">
        {t("同步说明:文件树着色照常工作(按各仓归属);幕布终端里的 git 命令不受影响;发现随切工作区")}
        {/* 32 = Rust git/repos_scan.rs 的 MAX_REPOS(跨语言常量,变更需双侧同步)。 */}
        {truncated && <b className="font-semibold text-(--tmd-fg-subtle)">{t(" 已截断,仅显示前 32 个。")}</b>}
      </div>
    </div>
  );
}
