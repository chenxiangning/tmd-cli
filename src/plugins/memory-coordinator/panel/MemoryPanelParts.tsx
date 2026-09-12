/**
 * Memory 面板拆件 —— 自 MemoryPanel.tsx 拆出(文件规模铁则)。
 *
 * 面板诊断 hook / 记忆列表行(截断摘要 + 展开详情 + 选择态 + hover 移除)/
 * 选择模式工具条 / 底部工具条(控制台切换 + 诊断 + 上游治理提示)。
 * 高亮与类目 label 拆至 memoryText.tsx;就绪头部与过滤 chips 在
 * MemoryPanelFilters.tsx(only-export-components 铁则)。
 */

import { useCallback, useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { type MemoryItem } from "../protocol";
import { memoryPool } from "../pool";
import { toggleConsoleTab } from "../console/consoleTab";
import { t } from "@kernel/i18n";
import { getSettingsState } from "@kernel/settings";
import { categoryLabel, highlight } from "./memoryText";

/**
 * 面板诊断状态 + 执行器 —— 池就绪与池不可用两态共用(不可用态同样要能
 * 点「诊断」排障、点「控制台」进安装流程;状态提升免两处复制)。
 */
export function useMemoryDiag() {
  const [diag, setDiag] = useState<string[]>([]);
  const [diagRunning, setDiagRunning] = useState(false);
  const runDiag = useCallback(() => {
    setDiagRunning(true);
    memoryPool
      .status()
      .then((st) => {
        const verdict = st.ready
          ? t("✓ 共享数据库可读")
          : st.reason === "locked"
            ? t("✗ 共享数据库不可读(被占用,疑似迁移窗口)")
            : t("✗ 共享数据库不可读(未安装或未迁移)");
        setDiag([verdict, t("✓ 检测完成 · {n} 条生效记忆", { n: st.count })]);
      })
      .finally(() => setDiagRunning(false));
  }, []);
  return { diag, diagRunning, runDiag };
}

export function MemoryListItem({
  m,
  query,
  selectMode,
  selected,
  expanded,
  archiving,
  onSelect,
  onExpand,
  onRemove,
}: {
  m: MemoryItem;
  query: string;
  selectMode: boolean;
  selected: boolean;
  expanded: boolean;
  archiving: boolean;
  onSelect: () => void;
  onExpand: () => void;
  onRemove: () => void;
}) {
  const activate = () => {
    if (selectMode) {
      onSelect();
      return;
    }
    onExpand();
  };
  return (
    <div
      className={`group relative rounded-md px-2 py-1.5 hover:bg-(--tmd-bg-hover) ${
        selected ? "bg-(--tmd-accent-soft)" : ""
      }`}
    >
      {/* 可点击行:div[role=button] + 键盘激活(Enter/Space);移除按钮同级绝对定位,避免交互嵌套 */}
      <div
        role="button"
        tabIndex={0}
        className={selectMode ? "cursor-pointer" : ""}
        onClick={activate}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            activate();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === " ") {
            e.preventDefault();
            activate();
          }
        }}
      >
        <div className="truncate text-[0.6875rem] leading-[1.5] text-(--tmd-fg)" title={m.content}>{highlight(m.content, query)}</div>
        <div className="mt-0.5 flex gap-1.5 text-[0.65625rem] text-(--tmd-fg-faint)">
          <span>{categoryLabel(m.category)}</span>
          <span>·</span>
          <span>{m.harness || "pi"}</span>
          <span>·</span>
          {/* 语言切换整树重挂载(kernel/i18n),非响应式读当前语言即可 */}
          <span>{new Date(m.updatedAt).toLocaleDateString(getSettingsState().settings.language)}</span>
          <CaretDown
            size="0.6875rem"
            className={`ml-auto transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </div>
        {expanded && (
          <div className="mt-1.5 flex flex-col gap-1 rounded-md border border-(--tmd-border) bg-(--tmd-bg-base) p-2 text-[0.65625rem] leading-relaxed">
            <div className="whitespace-pre-wrap break-words text-(--tmd-fg)">{m.content}</div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-(--tmd-fg-faint)">
              <span title={m.category}>{t("类目:{label}({code})", { label: categoryLabel(m.category), code: m.category })}</span>
              <span>{t("来源:{harness}", { harness: m.harness || "pi" })}</span>
              <span>{t("状态:{status}", { status: m.status })}</span>
              <span>{t("重要度:{v}", { v: m.importance ?? "—" })}</span>
              <span>ID:{m.id}</span>
              <span>{t("创建:{time}", { time: new Date(m.createdAt).toLocaleString("zh-CN") })}</span>
              <span>{t("更新:{time}", { time: new Date(m.updatedAt).toLocaleString("zh-CN") })}</span>
            </div>
          </div>
        )}
      </div>
      <button
        className={`absolute right-1.5 top-1.5 hidden rounded px-1.5 text-[0.625rem] group-hover:block ${
          archiving ? "text-(--tmd-fg-faint)" : "text-(--tmd-fg-muted) hover:text-(--tmd-err)"
        }`}
        disabled={archiving}
        onClick={onRemove}
        title={t("移除(经 omp 官方管线归档,可恢复)")}
      >
        {archiving ? t("归档中…") : t("移除")}
      </button>
    </div>
  );
}

/** 选择模式工具条:选择/退出 + 合并所选 + 合并进度提示。 */
export function MemorySelectBar({
  selectMode,
  selectedSize,
  merging,
  mergeNote,
  mergeDisabled,
  onToggleSelectMode,
  onMerge,
}: {
  selectMode: boolean;
  selectedSize: number;
  merging: boolean;
  mergeNote: string | null;
  mergeDisabled: boolean;
  onToggleSelectMode: () => void;
  onMerge: () => void;
}) {
  return (
    <>
      <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-1.5 px-1">
        <button
          className={`rounded-md border px-2 py-0.5 text-[0.65625rem] ${
            selectMode ? "border-(--tmd-accent) bg-(--tmd-accent-soft) text-(--tmd-fg)" : "border-(--tmd-border) text-(--tmd-fg-muted)"
          } hover:bg-(--tmd-bg-hover)`}
          onClick={onToggleSelectMode}
        >
          {selectMode ? t("退出选择") : t("选择")}
        </button>
        {selectMode && (
          <>
            <button
              className="flex-none rounded-md border border-(--tmd-accent) bg-(--tmd-accent) px-2 py-0.5 text-[0.65625rem] text-(--tmd-accent-fg) disabled:opacity-45"
              disabled={mergeDisabled}
              title={t("合并所选为一条(content 取首条表述,经 omp 官方管线 merge)")}
              onClick={onMerge}
            >
              {merging ? t("合并中…") : t("合并所选({n})", { n: selectedSize })}
            </button>
          </>
        )}
      </div>
      {selectMode && (
        <div className="mb-1.5 px-1 text-[0.625rem] text-(--tmd-fg-faint)">
          {mergeNote ?? t("选 2 条以上重复记忆折叠为一条")}
        </div>
      )}
    </>
  );
}

/** 底部工具条:控制台切换 + 诊断按钮 + 上游治理提示(诊断后显示结果行)。 */
export function MemoryPanelFooter({
  consoleOpen,
  diag,
  diagRunning,
  onDiag,
}: {
  consoleOpen: boolean;
  diag: string[];
  diagRunning: boolean;
  onDiag: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-none items-center gap-2 border-t border-(--tmd-border) px-2 py-1.5">
      <button
        className="flex-none rounded-md border border-(--tmd-border) px-2 py-0.5 text-[0.65625rem] text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
        onClick={toggleConsoleTab}
        title={t("打开/关闭中央编辑区的 Memory 控制台")}
      >
        {consoleOpen ? t("关闭控制台") : t("控制台")}
      </button>
      <button
        className="flex-none rounded-md border border-(--tmd-border) px-2 py-0.5 text-[0.65625rem] text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
        onClick={onDiag}
        disabled={diagRunning}
      >
        {diagRunning ? t("诊断中…") : t("诊断")}
      </button>
      {diag.length === 0 ? (
        <span className="min-w-0 flex-1 truncate text-[0.65625rem] text-(--tmd-fg-faint)" title={t("上游未暴露 CLI 触发;omp 会话内可用")}>
          {t("上游治理(/ctx-dream · /ctx-aug)在 omp 会话内执行;写入与移除经 omp 官方管线")}
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-[0.65625rem] text-(--tmd-fg-subtle)" title={diag.join("\n")}>
          {diag[diag.length - 1]}
        </span>
      )}
    </div>
  );
}
