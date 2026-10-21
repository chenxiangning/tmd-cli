/**
 * 检索浮层拆件(文件规模铁则)—— 过滤 chip 段 + 进度徽标 + 结果区(呈现件)。
 * 自 SearchOverlay.tsx 拆出,呈现契约不变(ResultBody 测试缝仍在原模块
 * re-export);索引推进循环在 indexerTicks.ts(组件文件只出组件纪律)。
 */
import { useState } from "react";
import { CaretDown, CaretUp, MagnifyingGlass } from "@phosphor-icons/react";
import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import { Empty } from "@kernel/Empty";
import { Spinner } from "@kernel/Spinner";
import { splitHits } from "@kernel/splitHits";
import { formatRelativeTime } from "@kernel/relativeTime";
import type { SessionIndex } from "./indexer";
import { TIME_FILTER_MS, type SessionSearchHit, type SessionSubHit, type TimeFilterKey } from "./searchCore";

/** 检索作用域(浮层局部 state,不持久化;042 裁决④):本区单 cwd / 全部工作区。 */
export type SearchScope = "ws" | "all";

/** chip 按钮(选中 = accent 软底;与目标引擎单选 chip 同视觉语系)。 */
function chipCls(on: boolean): string {
  return `rounded border px-1.5 py-px text-xs leading-4 ${
    on
      ? "border-(--tmd-accent) bg-(--tmd-accent)/10 text-(--tmd-fg)"
      : "border-(--tmd-border) text-(--tmd-fg-faint) hover:text-(--tmd-fg)"
  }`;
}

/** 时间 chip 键 → 展示文案键(zh 源串;en/ja 词典在 locales.ts)。 */
const TIME_FILTER_LABEL: Record<Exclude<TimeFilterKey, "all">, string> = {
  "24h": "24小时",
  "7d": "7天",
  "30d": "30天",
};

/** 过滤 chip 段:作用域(042 新增)/ 时间(静态枚举)/ 引擎(结果集生成)。 */
export function FilterChips(props: {
  scope: SearchScope;
  onScope: (s: SearchScope) => void;
  workspaceCount: number;
  timeFilter: TimeFilterKey;
  onTimeFilter: (k: TimeFilterKey) => void;
  engines: string[];
  engineFilter: string | null;
  onEngineFilter: (e: string | null) => void;
}) {
  const { scope, onScope, workspaceCount, timeFilter, onTimeFilter, engines, engineFilter, onEngineFilter } = props;
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-(--tmd-border) px-3 py-1.5">
      {/* 作用域 chip:切「全部」= 遍历 getWorkspaces() 各 root 喂同一索引器,
          零第二条管线;切回「本工作区」= effect 重建单区并中止扫描(缓存留存)。 */}
      <div className="flex items-center gap-1" role="group" aria-label={t("按作用域过滤")}>
        <button
          type="button"
          aria-pressed={scope === "ws"}
          onClick={() => onScope("ws")}
          className={chipCls(scope === "ws")}
        >
          {t("本工作区")}
        </button>
        <button
          type="button"
          aria-pressed={scope === "all"}
          onClick={() => onScope("all")}
          className={chipCls(scope === "all")}
        >
          {t("全部工作区({n})", { n: workspaceCount })}
        </button>
      </div>
      {/* 时间过滤 chip:静态枚举恒渲染(与结果集无关,常驻锚点)。 */}
      <div className="flex items-center gap-1 border-l border-(--tmd-border) pl-2" role="group" aria-label={t("按时间过滤")}>
        {(Object.keys(TIME_FILTER_MS) as TimeFilterKey[]).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={timeFilter === k}
            onClick={() => onTimeFilter(k)}
            className={chipCls(timeFilter === k)}
          >
            {k === "all" ? t("全部") : t(TIME_FILTER_LABEL[k])}
          </button>
        ))}
      </div>
      {engines.length > 1 && (
        /* 引擎过滤 chip:结果引擎集合生成(单引擎不出,无噪音)。 */
        <div className="flex items-center gap-1 border-l border-(--tmd-border) pl-2" role="group" aria-label={t("按引擎过滤")}>
          <button
            type="button"
            aria-pressed={engineFilter == null}
            onClick={() => onEngineFilter(null)}
            className={chipCls(engineFilter == null)}
          >
            {t("全部")}
          </button>
          {engines.map((e) => (
            <button
              key={e}
              type="button"
              aria-pressed={engineFilter === e}
              onClick={() => onEngineFilter(engineFilter === e ? null : e)}
              className={chipCls(engineFilter === e)}
            >
              {host.getCliProfile(e)?.name ?? e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 索引进度小徽标(输入行右侧)。 */
export function IndexingChip({ index }: { index: SessionIndex | null }) {
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs text-(--tmd-fg-faint)">
      <Spinner />
      {index ? t("索引中 {n}/{total}", { n: index.scanned, total: index.total }) : t("准备中…")}
    </span>
  );
}

/** 命中片段:纯文本 snippet 全部命中词切段标 <mark>(kernel splitHits 原语,
 *  批三收敛;旧实现只标首命中)。 */
function SnippetText({ text, token }: { text: string; token: string }) {
  return (
    <>
      {splitHits(text, token, false).map((part, i) =>
        part.hit ? (
          <mark key={i} className="rounded-[2px] bg-(--tmd-accent)/25 px-px text-inherit">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

/** 单条命中行:标题回退链(标题/首条消息/短 id)+ 工作区 pill(仅全部态)
 *  + usage 徽标 + 相对时间;失效区(root 复核失败)整行标灰 + 警示 pill。
 *  多命中(042 随手带):子命中 >1 出「N 处命中」展开钮,展开后每处一行
 *  snippet,点击跳该处(外层主行 = 首命中,Enter/点击语义不变)。 */
export function HitRow({ hit, onOpen, onOpenSub, selected, gone, workspaceName }: {
  hit: SessionSearchHit;
  onOpen: (hit: SessionSearchHit) => void;
  /** 子命中跳该处(与主行同一 openThenJumpToText 链,needle 换该处消息)。 */
  onOpenSub: (hit: SessionSearchHit, sub: SessionSubHit) => void;
  selected: boolean;
  /** 失效区命中:可看不可跳(点击仅 toast,定稿裁决③)。 */
  gone?: boolean;
  /** 全部作用域下的工作区显示名(本区态 = undefined 不出 pill,减噪音)。 */
  workspaceName?: string;
}) {
  /* 展开态行内自治:过滤/索引推进重建列表即复位(重查 = 重新决策,不记忆)。 */
  const [expanded, setExpanded] = useState(false);
  const expandable = hit.subHits.length > 1;
  return (
    <div
      data-sel={selected || undefined}
      className={`border-b border-(--tmd-border)/60 ${gone ? "opacity-55" : selected ? "bg-(--tmd-bg-hover)" : "hover:bg-(--tmd-bg-hover)"}`}
    >
      <button
        type="button"
        onClick={() => onOpen(hit)}
        className="block w-full px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-xs font-medium text-(--tmd-accent)">
            {host.getCliProfile(hit.entry.profileId)?.name ?? hit.entry.profileId}
          </span>
          {workspaceName && (
            <span className="shrink-0 rounded bg-(--tmd-bg-hover) px-1 text-xs text-(--tmd-fg-faint)">
              {workspaceName}
            </span>
          )}
          {gone && (
            <span className="shrink-0 rounded bg-(--tmd-warn)/15 px-1 text-xs text-(--tmd-warn)">
              {t("工作区已移走")}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-xs text-(--tmd-fg)">
            {hit.entry.title || hit.entry.messages[0]?.slice(0, 60) || hit.entry.cliSessionId}
          </span>
          {hit.entry.usage && (
            <span className="shrink-0 rounded bg-(--tmd-bg-hover) px-1 text-meta text-(--tmd-fg-faint)">
              {hit.entry.usage}
            </span>
          )}
          <span className="shrink-0 text-xs text-(--tmd-fg-faint)">
            {formatRelativeTime(hit.entry.modifiedAt)}
          </span>
        </div>
        <div className="mt-0.5 line-clamp-2 text-xs leading-4 text-(--tmd-fg-faint)">
          <SnippetText text={hit.snippet} token={hit.matchToken} />
        </div>
      </button>
      {expandable && (
        /* 「N 处命中」展开钮:独立行级控件,不与主行按钮嵌套(HTML 有效性)。 */
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="ml-3 mb-1.5 flex items-center gap-1 rounded border border-(--tmd-border) px-1.5 py-px text-xs text-(--tmd-fg-faint) hover:text-(--tmd-accent)"
        >
          {t("{n} 处命中", { n: hit.subHits.length })}
          {expanded ? <CaretUp size="0.6875rem" aria-hidden /> : <CaretDown size="0.6875rem" aria-hidden />}
        </button>
      )}
      {expanded && (
        <div className="border-t border-(--tmd-border)/40">
          {hit.subHits.map((sub) => (
            <button
              key={sub.mi}
              type="button"
              onClick={() => onOpenSub(hit, sub)}
              className="block w-full px-6 py-1.5 text-left text-xs leading-4 text-(--tmd-fg-faint) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
            >
              <SnippetText text={sub.snippet} token={sub.matchToken} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 无命中态(ResultBody 复杂度拆分):列举失败 alert / 空态双态文案(本区/全部可区分)。 */
function noHitsView(queryEmpty: boolean, indexing: boolean, index: SessionIndex | null, scopeAll: boolean) {
  if (queryEmpty) {
    return <Empty icon={<MagnifyingGlass />}>{t("输入关键词,按标题与你的历史输入检索会话")}</Empty>;
  }
  /* 列举失败是取数错误,不进空态形制:role=alert 红字(R6 分流)。 */
  if (!indexing && index && index.total === 0 && index.listFailed > 0) {
    return (
      <div role="alert" className="px-3 py-6 text-center text-xs text-(--tmd-err)">
        {t("会话列举失败:部分引擎的磁盘会话目录读不到")}
      </div>
    );
  }
  /* 空态双态:本区/全部文案可区分(目检判据);索引中/零会话/扫完无匹配分流。 */
  const hint = indexing
    ? t("索引还没扫到,稍候…")
    : index && index.total === 0
      ? scopeAll
        ? t("全部工作区都没有可检索的磁盘会话")
        : t("此工作区未发现可检索的磁盘会话")
      : scopeAll
        ? t("已扫 {w}/{wt} 个工作区,无匹配", { w: index?.scannedWorkspaces ?? 0, wt: index?.workspacesTotal ?? 0 })
        : t("已扫 {scanned}/{total} 个会话,无匹配", { scanned: index?.scanned ?? 0, total: index?.total ?? 0 });
  return <Empty icon={<MagnifyingGlass />}>{hint}</Empty>;
}

/** 结果区:未输入提示 / 无命中(索引中·空索引·列举失败·无匹配四分流)/ 命中列表。
 *  导出为测试缝(ExitSessionNotices 先例):钉选中呈现契约,键盘面走桩目检。
 *  scopeAll/goneCwds/workspaceNameOf 为跨区态(042):空态双态文案 + 行 pill。 */
export function ResultBody({ queryEmpty, indexing, index, hits, active, onOpen, onOpenSub, scopeAll = false, goneCwds, workspaceNameOf }: {
  queryEmpty: boolean;
  indexing: boolean;
  index: SessionIndex | null;
  hits: SessionSearchHit[];
  active: number;
  onOpen: (hit: SessionSearchHit) => void;
  /** 子命中跳该处(042 随手带):经同一 openHit 链,needle 换子命中消息。 */
  onOpenSub: (hit: SessionSearchHit, sub: SessionSubHit) => void;
  scopeAll?: boolean;
  goneCwds?: readonly string[];
  workspaceNameOf?: (id: string | undefined) => string | undefined;
}) {
  if (hits.length === 0) return noHitsView(queryEmpty, indexing, index, scopeAll);
  /* 失效区成员资格:循环外一次建集,行内 O(1) 判。 */
  const goneSet = new Set(goneCwds);
  return (
    <>
      {hits.map((hit, i) => (
        <HitRow
          key={`${hit.entry.cwd}:${hit.entry.profileId}:${hit.entry.cliSessionId}`}
          hit={hit}
          onOpen={onOpen}
          onOpenSub={onOpenSub}
          selected={i === active}
          gone={goneSet.has(hit.entry.cwd)}
          workspaceName={scopeAll ? workspaceNameOf?.(hit.entry.workspaceId) : undefined}
        />
      ))}
    </>
  );
}
