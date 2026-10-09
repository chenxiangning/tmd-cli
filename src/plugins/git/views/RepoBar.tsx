/**
 * RepoBar —— 多仓切换条(spec 2026-09-07-git-multi-repo-design §3;2026-10-09 交互改版)。
 * 仓库选择器(图 5 交互):左 = kind 图标 + 选中仓名 + 仓数 + ▾,点击弹纵向仓库列表
 * (dirty 降序,行 = kind 图标 + 仓名 + dirty 点/数 + ↑↓,当前仓 ✓;超 320px 滚动);
 * 右 = 本仓/全部段控(仅多本机工作区)。替代原横向滚动 chips(仓多时找仓要扒拉)。
 * 仅多仓模式渲染(GitPanel 分档),单仓零出现(回归红线)。
 * kind 图标/标签表拆至 repoKindMeta.ts(only-export-components,RepoGuide 同消费)。
 */

import { useMemo, useState } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import type { GitRepoSummary } from "@kernel/ipc";
import { useRepoChips } from "../hooks/useRepoChips";
import { MenuShell } from "../GitToolbar";
import { KIND_META } from "./repoKindMeta";

export function RepoBar({
  repos,
  truncated,
  selectedPath,
  chipSeq,
  onSelect,
  scope,
  onScope,
  showScope,
}: {
  repos: GitRepoSummary[];
  truncated: boolean;
  selectedPath: string;
  chipSeq: number;
  onSelect: (path: string) => void;
  /** 范围段控(本仓/全部,spec 2026-10-08-git-batch-ops-design):仅多本机工作区出现。 */
  scope: "repo" | "all";
  onScope: (scope: "repo" | "all") => void;
  showScope: boolean;
}) {
  const chips = useRepoChips(repos, chipSeq);
  const ordered = useMemo(() => {
    if (chips.size === 0) return repos;
    const dirtyOf = (path: string) => chips.get(path)?.dirty ?? -1;
    return [...repos].sort((a, b) => dirtyOf(b.path) - dirtyOf(a.path));
  }, [repos, chips]);
  const active = repos.find((r) => r.path === selectedPath) ?? repos[0];
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  // 扫描在途空窗期(showScope 先于首批 repos 到达):整条不渲染,对齐旧空 chips 条的视觉零占位。
  if (!active) return null;
  const ActiveIcon = KIND_META[active.kind].icon;
  return (
    <div className="flex shrink-0 items-center border-b border-(--tmd-border)">
      <button
        type="button"
        aria-haspopup="menu"
        title={
          truncated
            ? t("仓数已达发现上限({n}),仅显示前 {n} 仓", { n: repos.length })
            : t("切换仓库")
        }
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setPicker({ x: rect.left, y: rect.bottom + 2 });
        }}
        className="flex h-[26px] min-w-0 flex-1 items-center gap-1.5 rounded px-2 text-xs text-(--tmd-fg) hover:bg-(--tmd-bg-hover)"
      >
        <ActiveIcon size="0.75rem" weight="fill" className="shrink-0 text-(--tmd-accent)" aria-hidden />
        <span className="min-w-0 truncate font-semibold">{active.name}</span>
        <span className="shrink-0 text-meta whitespace-nowrap text-(--tmd-fg-muted) tabular-nums">
          {repos.length}
          {truncated ? "+" : ""}
        </span>
        <CaretDown className="h-3 w-3 shrink-0 text-(--tmd-fg-faint)" aria-hidden />
      </button>
      {showScope && (
        <span className="mr-1 flex shrink-0 items-center gap-px self-center rounded-[5px] border border-(--tmd-border) p-px">
          {(["repo", "all"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onScope(s)}
              className={`h-4 rounded-[3px] px-1.5 text-[10px] ${
                scope === s
                  ? "bg-(--tmd-bg-hover) font-semibold text-(--tmd-fg)"
                  : "text-(--tmd-fg-muted)"
              }`}
            >
              {s === "repo" ? t("本仓") : t("全部")}
            </button>
          ))}
        </span>
      )}
      {picker && (
        <MenuShell position={picker} width={240} onClose={() => setPicker(null)}>
          <div className="max-h-[320px] overflow-y-auto">
            {ordered.map((r) => {
              const isActive = r.path === selectedPath;
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
                <button
                  key={r.path}
                  type="button"
                  role="menuitem"
                  title={title}
                  onClick={() => {
                    onSelect(r.path);
                    setPicker(null);
                  }}
                  className={`flex w-full items-center gap-2 rounded-[5px] px-2 py-1 text-left text-xs tabular-nums ${
                    isActive
                      ? "text-(--tmd-fg)"
                      : "text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
                  }`}
                >
                  <KindIcon
                    size="0.75rem"
                    weight={isActive ? "fill" : "regular"}
                    className={`shrink-0 ${isActive ? "text-(--tmd-accent)" : "text-(--tmd-fg-faint)"}`}
                    aria-hidden
                  />
                  <span className={`min-w-0 flex-1 truncate ${isActive ? "font-semibold" : ""}`}>
                    {r.name}
                  </span>
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
                    <span className="text-meta text-(--tmd-diff-inserted)">↑{chip.ahead}</span>
                  )}
                  {chip && chip.behind > 0 && (
                    <span className="text-meta text-(--tmd-diff-removed)">↓{chip.behind}</span>
                  )}
                  {isActive && <Check className="h-3 w-3 shrink-0 text-(--tmd-accent)" aria-hidden />}
                </button>
              );
            })}
          </div>
        </MenuShell>
      )}
    </div>
  );
}
