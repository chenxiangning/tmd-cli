/**
 * Memory 面板头部与过滤 chips —— 池就绪摘要/详情 + 来源/类目过滤
 * (no-high-complexity 降分支拆件):MemoryPanel.tsx 只留数据编排与列表。
 */

import { useMemo } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { type MemoryItem } from "../protocol";
import { categoryLabel } from "./memoryText";

/** 详情键值行(库路径/身份共用,duplicate-jsx 去重)。 */
function InfoRow({ text, title }: { text: string; title: string }) {
  return (
    <div className="truncate" title={title}>{text}</div>
  );
}

/** 池就绪摘要行 + 展开详情(库路径/身份/类目覆盖);detailOpen 状态由父级持有。 */
export function MemoryHead({
  detailOpen,
  onToggle,
  identity,
  dbPath,
  count,
  items,
}: {
  detailOpen: boolean;
  onToggle: () => void;
  identity: string | null;
  dbPath: string | null;
  count: number;
  items: MemoryItem[];
}) {
  const kindCount = useMemo(() => new Set(items.map((m) => m.category)).size, [items]);
  return (
    <>
      <button
        className="mb-2 flex w-full items-center gap-2 px-1 pt-1 text-left"
        onClick={onToggle}
      >
        <span className="h-2 w-2 flex-none rounded-full bg-(--tmd-ok)" />
        <span className="text-[0.6875rem] text-(--tmd-fg-muted)">{t("池就绪")}</span>
        <span className="ml-auto text-[0.6875rem] font-semibold">{t("{count} 条", { count })}</span>
        <CaretDown size="0.6875rem" className={detailOpen ? "rotate-180 transition-transform" : "transition-transform"} />
      </button>
      {detailOpen && (
        <div className="mb-2 flex flex-col gap-0.5 rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) p-2 font-mono text-[0.625rem] text-(--tmd-fg-muted)">
          <InfoRow text={t("库:{path}", { path: dbPath ?? t("未解析") })} title={dbPath ?? t("未解析")} />
          <InfoRow text={t("身份:{id}", { id: identity ?? t("非 git 工作区") })} title={identity ?? t("非 git 工作区")} />
          <div>{t("生效记忆:{count} 条 · 覆盖类目:{kinds} 类", { count, kinds: kindCount })}</div>
          <div className="truncate text-(--tmd-fg-faint)">
            {t("提示:记忆由 omp/pi 会话沉淀(原生注入),其余引擎经胶囊读取;写入与治理见控制台。")}
          </div>
        </div>
      )}
    </>
  );
}

/** 来源/类目过滤 chips:多来源/多类目时才出现(行为同拆分前)。 */
export function MemoryFilterChips({
  items,
  source,
  onSource,
  kind,
  onKind,
}: {
  items: MemoryItem[];
  source: string;
  onSource: (s: string) => void;
  kind: string;
  onKind: (k: string) => void;
}) {
  const presentSources = useMemo(() => countBy(items, (m) => m.harness || "pi"), [items]);
  const presentKinds = useMemo(() => countBy(items, (m) => m.category), [items]);

  return (
    <>
      {presentSources.length > 1 && (
        <ChipRow
          entries={presentSources}
          current={source}
          onSelect={onSource}
          allLabel={t("全部来源")}
          renderItem={(key, n) => `${key} ${n}`}
        />
      )}
      {presentKinds.length > 0 && (
        <ChipRow
          entries={presentKinds}
          current={kind}
          onSelect={onKind}
          allLabel={t("全部 {n}", { n: items.length })}
          renderItem={(key, n) => `${categoryLabel(key)} ${n}`}
        />
      )}
    </>
  );
}

/** chip 行(来源/类目共用):容器 + 全部项 + 计数项,选中态高亮(duplicate-jsx 去重)。 */
function ChipRow({
  entries,
  current,
  onSelect,
  allLabel,
  renderItem,
}: {
  entries: [string, number][];
  current: string;
  onSelect: (v: string) => void;
  allLabel: string;
  renderItem: (key: string, n: number) => string;
}) {
  return (
    <div className="mb-1.5 flex flex-wrap gap-1 px-1">
      <ChipBtn active={current === "all"} onClick={() => onSelect("all")}>{allLabel}</ChipBtn>
      {entries.map(([key, n]) => (
        <ChipBtn key={key} active={current === key} onClick={() => onSelect(current === key ? "all" : key)}>
          {renderItem(key, n)}
        </ChipBtn>
      ))}
    </div>
  );
}

/** 单个 chip 胶囊。 */
function ChipBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={`h-5 rounded-full border px-2 text-[0.65625rem] ${
        active
          ? "border-(--tmd-accent) bg-(--tmd-bg-active) text-(--tmd-fg)"
          : "border-(--tmd-border) text-(--tmd-fg-subtle)"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** 按取值计数并降序(纯函数)。 */
function countBy(items: MemoryItem[], key: (m: MemoryItem) => string): [string, number][] {
  const by = new Map<string, number>();
  for (const m of items) by.set(key(m), (by.get(key(m)) ?? 0) + 1);
  return [...by.entries()].sort((a, b) => b[1] - a[1]);
}

