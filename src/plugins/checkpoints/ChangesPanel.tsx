/**
 * ChangesPanel —— 右栏「变更」页签(0.4.0 项11):本会话跨批次按文件折叠的
 * 变更总览。纯前端:数据源 = state.batches 单 prop(与 TimelinePanel 同款
 * hidden 保活挂载),折叠/状态合成/过滤/排序纯逻辑拆 changesData.ts(单测锁
 * 优先级矩阵);± 为账本累计口径(封口瞬间固化,回退不回缩),与批审阅单
 * 懒加载 diff 求和口径不同 —— footbar 双注明。行点击 openBatchTab 深链最近
 * 批审阅单并 focusPath 定位该文件(marks/evidenceScope 先例)。
 */

import { useMemo, useState } from "react";
import { GitDiff } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { Empty } from "@kernel/Empty";
import { openBatchTab } from "./batchTab";
import { classifyRisk } from "./risk";
import {
  capRows,
  filterGroups,
  foldFileChanges,
  sortGroups,
  summarizeChanges,
  synthesizeChange,
  type ChangeFilter,
  type ChangeMainState,
  type ChangeSort,
  type FileChangeGroup,
} from "./changesData";
import type { CkptBatch } from "@kernel/ipc";

/** 稳定空表:batches 缺省时复用同一引用,list 身份不随渲染漂(useMemo 依赖诚实)。 */
const NO_CHANGES: readonly CkptBatch[] = [];

/** 主态 → 中文词条键(状态药丸与过滤 chip 共用)。 */
const STATE_LABEL: Record<ChangeMainState, string> = {
  running: "改动中",
  changed: "内容已变",
  committed: "已提交",
  reverted: "已回退",
  deleted: "已删除",
};

/** 主态 → 药丸配色(复用现有语义色:STATE_META open=进行中/pending=待审/
    approved=已通过 同源;紫 = 回退语义色,红 = 删除,均钉死沿用既有先例)。 */
const STATE_PILL_CLS: Record<ChangeMainState, string> = {
  running: "bg-(--tmd-accent-soft) text-(--tmd-accent)",
  changed: "bg-(--tmd-git-modified)/15 text-(--tmd-git-modified)",
  committed: "bg-(--tmd-diff-inserted)/15 text-(--tmd-diff-inserted)",
  reverted: "bg-[#a78bfa]/15 text-[#a78bfa]",
  deleted: "bg-(--tmd-diff-removed)/15 text-(--tmd-diff-removed)",
};

/** 过滤 chip 六档(顺序 = 主态展示序)。 */
const FILTERS: readonly { key: ChangeFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "running", label: STATE_LABEL.running },
  { key: "changed", label: STATE_LABEL.changed },
  { key: "committed", label: STATE_LABEL.committed },
  { key: "reverted", label: STATE_LABEL.reverted },
  { key: "deleted", label: STATE_LABEL.deleted },
];

/** 账本 ± 片段(ins/del 双色,批头同款 mono 形制)。 */
function PmSpan({ ins, del }: { ins: number; del: number }) {
  return (
    <span className="flex-none font-mono text-2xs">
      <span className="text-(--tmd-diff-inserted)">+{ins}</span>{" "}
      <span className="text-(--tmd-diff-removed)">−{del}</span>
    </span>
  );
}

/** 状态药丸簇:主态药丸 + 无前像附加 chip(no_baseline 不改主态,仅摘回退语义)。 */
function StatePills({ g }: { g: FileChangeGroup }) {
  const st = synthesizeChange(g.latestFile);
  return (
    <>
      <span
        className={`flex-none rounded-full px-1.5 text-meta font-semibold leading-3.5 ${STATE_PILL_CLS[st]}`}
      >
        {t(STATE_LABEL[st])}
      </span>
      {g.latestFile.noBaseline && (
        <span
          className="flex-none rounded border border-dashed border-(--tmd-fg-faint) px-1 text-meta leading-3.5 text-(--tmd-fg-faint)"
          title={t("工作区外文件,首轮批前像不可知 —— 禁回退(防误删既有文件);次轮起可正常回退")}
        >
          {t("无前像")}
        </span>
      )}
    </>
  );
}

/** 单文件折叠行:文件名 + 药丸簇 + ±(账本累计)+ 最近批 #序/prompt 首行 + 批次数。
    行点击深链最近批审阅单(openBatchTab focusPath,审阅单滚动定位该文件分区)。 */
function ChangeRow({
  g,
  cwd,
  sessionId,
  tmdSessionId,
}: {
  g: FileChangeGroup;
  cwd: string | null;
  sessionId: string | null;
  tmdSessionId: string | undefined;
}) {
  const name = g.path.split("/").pop() ?? g.path;
  return (
    <button
      type="button"
      className="block w-full rounded-(--tmd-radius-sm) px-1 py-1.5 text-left hover:bg-(--tmd-bg-hover)"
      title={t("打开批次审阅单并定位该文件")}
      onClick={() => {
        if (!cwd || !sessionId) return;
        openBatchTab({
          cwd,
          sessionId,
          tmdSessionId,
          batchId: g.latestBatch.id,
          title: t("批次 #{index}", { index: g.latestBatch.index }),
          focusPath: g.path,
        });
      }}
    >
      <span className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={g.path}>
          {name}
        </span>
        {classifyRisk(g.path) === "high" && (
          <span
            className="flex-none rounded bg-(--tmd-diff-removed)/15 px-1 text-meta font-bold leading-3.5 text-(--tmd-diff-removed)"
            title={t("高危文件(凭据/Shell 配置/CI/服务),建议细读 diff")}
          >
            {t("高危")}
          </span>
        )}
        <PmSpan ins={g.additions} del={g.deletions} />
      </span>
      <span className="mt-0.5 flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs text-(--tmd-fg-faint)">
        <StatePills g={g} />
        <span className="flex-none">#{g.latestBatch.index}</span>
        <span className="min-w-0 flex-1 truncate">{g.latestBatch.prompt.split("\n")[0]}</span>
        <span className="flex-none">{t("{n} 批", { n: g.batchCount })}</span>
      </span>
    </button>
  );
}

/** 变更总览 —— 折叠/过滤/排序纯逻辑见 changesData.ts(单测面);本组件只装配。 */
export function ChangesPanel({
  batches,
  cwd,
  sessionId,
  tmdSessionId,
}: {
  batches?: readonly CkptBatch[];
  cwd: string | null;
  sessionId: string | null;
  tmdSessionId?: string;
}) {
  const [filter, setFilter] = useState<ChangeFilter>("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<ChangeSort>("batch");
  const [expanded, setExpanded] = useState(false);

  const list = batches ?? NO_CHANGES;
  const groups = useMemo(() => foldFileChanges(list), [list]);
  const summary = useMemo(() => summarizeChanges(groups), [groups]);
  const visible = useMemo(
    () => sortGroups(filterGroups(groups, filter, q), sort),
    [groups, filter, q, sort],
  );
  /* cap 只管无过滤的浏览态:过滤/展开即看全量(过滤作用于全量后再裁剪的逆命题)。 */
  const filtering = filter !== "all" || q.trim() !== "";
  const rows = capRows(visible, { filtering, expanded });
  const hidden = visible.length - rows.length;

  if (list.length === 0) {
    return (
      <Empty icon={<GitDiff />}>
        {t("本会话还没有文件变更 —— AI 改动文件后,这里按文件折叠显示")}
      </Empty>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 摘要条:全会话口径,不随过滤变 —— 总览回答「本会话动过多少」 */}
      <div className="flex flex-none flex-wrap items-center gap-x-2.5 gap-y-0.5 border-b border-(--tmd-border) px-2.5 py-1.5 text-meta text-(--tmd-fg-faint)">
        <span>{t("{n} 文件", { n: summary.files })}</span>
        <span>{t("{n} 可回退", { n: summary.revertible })}</span>
        {summary.highRisk > 0 && (
          <span className="font-semibold text-(--tmd-diff-removed)">
            {t("{n} 高危", { n: summary.highRisk })}
          </span>
        )}
        <PmSpan ins={summary.additions} del={summary.deletions} />
        <span>({t("账本累计")})</span>
      </div>

      {/* 过滤 chips + 路径子串过滤 + 排序切换 */}
      <div className="flex flex-none flex-wrap items-center gap-1 border-b border-(--tmd-border) px-2.5 py-1.5">
        {FILTERS.map((f) => {
          const on = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              className={`flex-none rounded-full border px-2 py-px text-2xs leading-3.5 ${
                on
                  ? "border-(--tmd-accent) bg-(--tmd-accent-soft) font-medium text-(--tmd-accent)"
                  : "border-(--tmd-border) text-(--tmd-fg-faint) hover:text-(--tmd-fg)"
              }`}
              onClick={() => setFilter(f.key)}
            >
              {t(f.label)}
            </button>
          );
        })}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("路径过滤,如 sweep")}
          className="w-full rounded border border-(--tmd-border) bg-transparent px-1.5 py-0.5 text-xs text-(--tmd-fg) outline-none placeholder:text-(--tmd-fg-faint) focus:border-(--tmd-accent)"
        />
        <span className="flex-1" />
        <button
          type="button"
          title={t("按最近批时间降序")}
          className={`rounded px-1.5 text-2xs leading-3.5 ${
            sort === "batch"
              ? "bg-(--tmd-bg-hover) font-semibold text-(--tmd-fg)"
              : "text-(--tmd-fg-faint) hover:text-(--tmd-fg)"
          }`}
          onClick={() => setSort("batch")}
        >
          {t("最近批")}
        </button>
        <button
          type="button"
          title={t("按账本 ± 行数降序")}
          className={`rounded px-1.5 font-mono text-2xs leading-3.5 ${
            sort === "pm"
              ? "bg-(--tmd-bg-hover) font-semibold text-(--tmd-fg)"
              : "text-(--tmd-fg-faint) hover:text-(--tmd-fg)"
          }`}
          onClick={() => setSort("pm")}
        >
          ±
        </button>
      </div>

      {/* 文件折叠行(cap 50,超出折叠为「还有 N 个文件」展开行);过滤命中 0 显式空态 */}
      <div className="min-h-0 flex-1 overflow-y-auto py-1 pr-1 pl-0.5">
        {rows.length === 0 ? (
          <Empty>{t("无匹配文件 —— 换个状态档或清空路径过滤")}</Empty>
        ) : (
          rows.map((g) => (
            <ChangeRow key={g.path} g={g} cwd={cwd} sessionId={sessionId} tmdSessionId={tmdSessionId} />
          ))
        )}
        {hidden > 0 && (
          <button
            type="button"
            className="w-full rounded py-1.5 text-center text-xs text-(--tmd-accent) hover:bg-(--tmd-accent-soft)"
            onClick={() => setExpanded(true)}
          >
            {t("还有 {n} 个文件 · 点击展开", { n: hidden })}
          </button>
        )}
      </div>

      {/* 口径注:两套 ± 口径双注明,免与批审阅单数字互猜 */}
      <div className="flex-none border-t border-(--tmd-border) px-2.5 py-1 text-2xs text-(--tmd-fg-faint)">
        {t("± 为账本累计口径,回退不回缩;逐文件 diff 见批次审阅单")}
      </div>
    </div>
  );
}
