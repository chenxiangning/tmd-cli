/**
 * 检索浮层拆件(文件规模铁则)—— 进度徽标 + 结果区(呈现件)。
 * 自 SearchOverlay.tsx 拆出,呈现契约不变(ResultBody 测试缝仍在原模块
 * re-export);索引推进循环在 indexerTicks.ts(组件文件只出组件纪律)。
 */
import { CircleNotch } from "@phosphor-icons/react";
import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import { formatRelativeTime } from "@kernel/relativeTime";
import type { SessionIndex, SessionSearchHit } from "./indexer";

/** 索引进度小徽标(输入行右侧)。 */
export function IndexingChip({ index }: { index: SessionIndex | null }) {
  return (
    <span className="flex shrink-0 items-center gap-1 text-[0.6875rem] text-(--tmd-fg-faint)">
      <CircleNotch size="0.75rem" className="animate-spin" aria-hidden />
      {index ? t("索引中 {n}/{total}", { n: index.scanned, total: index.total }) : t("准备中…")}
    </span>
  );
}

/** 命中片段:纯文本 snippet 按首个命中词切三段拼 React 节点(中间段 <mark>)。 */
function SnippetText({ text, token }: { text: string; token: string }) {
  const at = token ? text.toLowerCase().indexOf(token.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-[2px] bg-(--tmd-accent)/25 px-px text-inherit">
        {text.slice(at, at + token.length)}
      </mark>
      {text.slice(at + token.length)}
    </>
  );
}

/** 单条命中行:标题回退链(标题/首条消息/短 id)+ usage 徽标 + 相对时间。 */
export function HitRow({ hit, onOpen, selected }: { hit: SessionSearchHit; onOpen: (profileId: string, cliSessionId: string) => void; selected: boolean }) {
  return (
    <button
      type="button"
      data-sel={selected || undefined}
      onClick={() => onOpen(hit.entry.profileId, hit.entry.cliSessionId)}
      className={`block w-full border-b border-(--tmd-border)/60 px-3 py-2 text-left ${selected ? "bg-(--tmd-bg-hover)" : "hover:bg-(--tmd-bg-hover)"}`}
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[0.6875rem] font-medium text-(--tmd-accent)">
          {host.getCliProfile(hit.entry.profileId)?.name ?? hit.entry.profileId}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-(--tmd-fg)">
          {hit.entry.title || hit.entry.messages[0]?.slice(0, 60) || hit.entry.cliSessionId}
        </span>
        {hit.entry.usage && (
          <span className="shrink-0 rounded bg-(--tmd-bg-hover) px-1 text-[0.625rem] text-(--tmd-fg-faint)">
            {hit.entry.usage}
          </span>
        )}
        <span className="shrink-0 text-[0.6875rem] text-(--tmd-fg-faint)">
          {formatRelativeTime(hit.entry.modifiedAt)}
        </span>
      </div>
      <div className="mt-0.5 line-clamp-2 text-[0.75rem] leading-4 text-(--tmd-fg-faint)">
        <SnippetText text={hit.snippet} token={hit.matchToken} />
      </div>
    </button>
  );
}

/** 结果区:未输入提示 / 无命中(索引中·空索引·列举失败·无匹配四分流)/ 命中列表。
 *  导出为测试缝(ExitSessionNotices 先例):钉选中呈现契约,键盘面走桩目检。 */
export function ResultBody({ queryEmpty, indexing, index, hits, active, onOpen }: {
  queryEmpty: boolean;
  indexing: boolean;
  index: SessionIndex | null;
  hits: SessionSearchHit[];
  active: number;
  onOpen: (profileId: string, cliSessionId: string) => void;
}) {
  if (queryEmpty) {
    return (
      <div className="px-3 py-6 text-center text-xs text-(--tmd-fg-faint)">
        {t("输入关键词,按标题与你的历史输入检索会话")}
      </div>
    );
  }
  if (hits.length === 0) {
    const hint = indexing
      ? t("索引还没扫到,稍候…")
      : index && index.total === 0
        ? index.listFailed > 0
          ? t("会话列举失败:部分引擎的磁盘会话目录读不到")
          : t("此工作区未发现可检索的磁盘会话")
        : t("已扫 {scanned}/{total} 个会话,无匹配", { scanned: index?.scanned ?? 0, total: index?.total ?? 0 });
    return <div className="px-3 py-6 text-center text-xs text-(--tmd-fg-faint)">{hint}</div>;
  }
  return (
    <>
      {hits.map((hit, i) => (
        <HitRow key={`${hit.entry.profileId}:${hit.entry.cliSessionId}`} hit={hit} onOpen={onOpen} selected={i === active} />
      ))}
    </>
  );
}
