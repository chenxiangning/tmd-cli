/**
 * RepoBar —— 多仓切换条(spec 2026-09-07-git-multi-repo-design §3)。
 * 无胶囊平铺单元:kind 小图标 + 仓名 + dirty 点/数 + ↑↓,仓间虚线分隔;
 * (chips 未到沉底)。超宽横滚但滚动条视觉隐藏(.repo-bar-scroll,git-panel.css)。
 * 仅多仓模式渲染(GitPanel 分档),单仓零出现(回归红线)。
 * kind 图标/标签表拆至 repoKindMeta.ts(only-export-components,RepoGuide 同消费)。
 */

import { useMemo } from "react";
import { t } from "@kernel/i18n";
import type { GitRepoSummary } from "@kernel/ipc";
import { useRepoChips } from "../hooks/useRepoChips";
import { KIND_META } from "./repoKindMeta";

export function RepoBar({
  repos,
  truncated,
  selectedPath,
  chipSeq,
  onSelect,
}: {
  repos: GitRepoSummary[];
  truncated: boolean;
  selectedPath: string;
  chipSeq: number;
  onSelect: (path: string) => void;
}) {
  const chips = useRepoChips(repos, chipSeq);
  const ordered = useMemo(() => {
    if (chips.size === 0) return repos;
    const dirtyOf = (path: string) => chips.get(path)?.dirty ?? -1;
    return [...repos].sort((a, b) => dirtyOf(b.path) - dirtyOf(a.path));
  }, [repos, chips]);
  return (
    <div className="flex shrink-0 items-stretch border-b border-(--tmd-border)">
      <span
        title={
          truncated
            ? t("仓数已达发现上限({n}),仅显示前 {n} 仓", { n: repos.length })
            : t("工作区内发现的 Git 仓库数")
        }
        className="flex shrink-0 items-center pl-2 text-[0.625rem] whitespace-nowrap text-(--tmd-fg-muted) tabular-nums"
      >
        {repos.length}
        {truncated ? "+" : ""} {t("仓")}
      </span>
      <span className="repo-bar-divider self-center" aria-hidden />
      <div className="repo-bar-scroll flex min-w-0 flex-1 items-center overflow-x-auto px-1 py-[3px]">
      {ordered.map((r, idx) => {
        const active = r.path === selectedPath;
        const chip = chips.get(r.path);
        const dirty = chip?.dirty ?? -1;
        const kindLabel = KIND_META[r.kind].label;
        const title = [
          `${r.name} · ${chip?.branch || r.branch}`,
          kindLabel ? t(kindLabel) : null,
          chip?.upstream ? `→ ${chip.upstream}` : null,
          dirty >= 0 ? t("{n} 个变更", { n: dirty }) : null,
          chip && chip.ahead > 0 ? t("领先 {n} 个提交", { n: chip.ahead }) : null,
          chip && chip.behind > 0 ? t("落后 {n} 个提交", { n: chip.behind }) : null,
        ]
          .filter((s): s is string => s != null)
          .join("\n");
        const KindIcon = KIND_META[r.kind].icon;
        return (
          <span key={r.path} className="flex shrink-0 items-stretch">
            {idx > 0 && <span className="repo-bar-divider" aria-hidden />}
            <button
              type="button"
              title={title}
              onClick={() => onSelect(r.path)}
              className={`inline-flex h-[20px] shrink-0 items-center gap-1.5 rounded px-1.5 text-[0.6875rem] whitespace-nowrap tabular-nums transition-colors ${
                active
                  ? "text-(--tmd-fg)"
                  : "text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
              }`}
            >
              <KindIcon
                size="0.75rem"
                weight={active ? "fill" : "regular"}
                className={`shrink-0 ${active ? "text-(--tmd-accent)" : "text-(--tmd-fg-faint)"}`}
                aria-hidden
              />
              <span className={active ? "font-semibold" : undefined}>{r.name}</span>
              {dirty > 0 && (
                <>
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--tmd-git-modified)"
                    aria-hidden
                  />
                  <span>{dirty}</span>
                </>
              )}
              {chip && chip.ahead > 0 && (
                <span className="text-[0.625rem] text-(--tmd-diff-inserted)">↑{chip.ahead}</span>
              )}
              {chip && chip.behind > 0 && (
                <span className="text-[0.625rem] text-(--tmd-diff-removed)">↓{chip.behind}</span>
              )}
            </button>
          </span>
        );
      })}
      </div>
    </div>
  );
}
