/**
 * 增强对话框 —— 并排对照(spec 2026-09-21,阶段 2 增强):
 * 引擎选择 + 强度三档 + 开始增强;高级设置折叠(超时/模型);历史记录切换;
 * 同 草稿+引擎+档位+模型 命中缓存秒回(再点强制重跑);lastUsed 记忆上次组合;
 * 左原始可改、右增强只读;底部保留原始版本 / 使用增强版本(整替草稿)。
 */

import { useEffect, useRef, useState } from "react";
import { CaretDownIcon, CaretRightIcon, PencilSimpleIcon, PlayIcon, SparkleIcon } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { DialogShell } from "@kernel/DialogShell";
import { StyledSelect } from "@kernel/StyledSelect";
import { composerReplaceRef } from "@kernel/composerExt";
import {
  ENHANCE_ENGINES,
  clampTimeoutSeconds,
  runEnhance,
  type EnhanceOutcome,
  type EnhancePreset,
} from "./enhanceEngines";
import { pushHistory, readCache, setLastUsed, writeCache, ensureLoaded, getLastUsed } from "./enhanceStore";
import { EnhancedPane } from "./EnhancePanes";
import { EnhanceHistory } from "./EnhanceHistory";
import type { EnhanceHistoryEntry } from "./enhanceStore";

const PRESETS: Array<{ id: EnhancePreset; label: string; hint: string }> = [
  { id: "light", label: t("轻润色"), hint: t("只整理措辞,短句不扩写") },
  { id: "structured", label: t("结构化"), hint: t("分小节重组,不虚构事实") },
  { id: "executable", label: t("可执行"), hint: t("压成短句清单,只留约束与交付格式") },
];

export function EnhanceDialog({
  cwd,
  workspaceId,
  initialDraft,
  onClose,
}: {
  cwd: string;
  workspaceId: string | null;
  initialDraft: string;
  onClose: () => void;
}) {
  const [engineId, setEngineId] = useState("claude");
  const [preset, setPreset] = useState<EnhancePreset>("light");
  const [original, setOriginal] = useState(initialDraft);
  const [enhanced, setEnhanced] = useState("");
  const [live, setLive] = useState("");
  const [running, setRunning] = useState(false);
  const [fail, setFail] = useState<Extract<EnhanceOutcome, { ok: false }> | null>(null);
  const [timeoutSeconds, setTimeoutSeconds] = useState(60);
  const [model, setModel] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [view, setView] = useState<"panes" | "history">("panes");
  const [fromCache, setFromCache] = useState(false);
  const activePreset = PRESETS.find((p) => p.id === preset) ?? PRESETS[0];
  /* 缓存命中后同一按钮变强制重跑(再点一次绕过缓存) */
  const fromCacheRef = useRef(false);

  /* 恢复上次选择(引擎/档位/模型/超时) */
  useEffect(() => {
    void ensureLoaded().then(() => {
      const lu = getLastUsed();
      if (!lu) return;
      if (ENHANCE_ENGINES.some((e) => e.id === lu.engineId)) setEngineId(lu.engineId);
      setPreset(lu.preset);
      setModel(lu.model);
      setTimeoutSeconds(clampTimeoutSeconds(lu.timeoutSeconds));
    });
  }, []);

  const run = async () => {
    if (running || !original.trim() || !cwd) return;
    setLastUsed({ engineId, preset, model: model.trim(), timeoutSeconds });
    if (fromCacheRef.current) {
      /* 显示的是缓存:本次点击 = 强制重跑 */
      fromCacheRef.current = false;
      setFromCache(false);
    } else {
      const hit = readCache(engineId, preset, model.trim(), original);
      if (hit) {
        fromCacheRef.current = true;
        setFromCache(true);
        setFail(null);
        setEnhanced(hit);
        return;
      }
    }
    setRunning(true);
    setFail(null);
    setEnhanced("");
    setLive("");
    const out = await runEnhance({
      engineId,
      draft: original,
      preset,
      model: model.trim() || null,
      cwd,
      workspaceId,
      timeoutSeconds,
      onChunk: setLive,
    });
    setRunning(false);
    if (out.ok) {
      setEnhanced(out.text);
      writeCache(engineId, preset, model.trim(), original, out.text);
      pushHistory({ original, enhanced: out.text, engineId, preset, model: model.trim(), at: Date.now() });
    } else {
      setFail(out);
    }
  };

  const pickHistory = (e: EnhanceHistoryEntry) => {
    setOriginal(e.original);
    setEnhanced(e.enhanced);
    setEngineId(e.engineId);
    setPreset(e.preset);
    setModel(e.model);
    setFail(null);
    fromCacheRef.current = false;
    setFromCache(false);
    setView("panes");
  };

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs transition-colors ${
      active
        ? "border-(--tmd-accent) bg-(--tmd-accent-soft) text-(--tmd-accent)"
        : "border-(--tmd-border) text-(--tmd-fg-muted) hover:text-(--tmd-fg)"
    }`;

  return (
    <DialogShell
      title={t("增强提示词")}
      icon={<SparkleIcon size="0.875rem" className="text-(--tmd-accent)" weight="fill" />}
      width={880}
      locked={running}
      onClose={onClose}
      footer={
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-(--tmd-border) px-3 py-1.5 text-xs text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
          >
            {t("保留原始版本")}
          </button>
          <button
            type="button"
            disabled={!enhanced}
            onClick={() => {
              composerReplaceRef.current?.(enhanced);
              onClose();
            }}
            title={enhanced ? undefined : t("增强失败")}
            className="rounded bg-(--tmd-accent) px-3 py-1.5 text-xs text-(--tmd-accent-fg) hover:opacity-90 disabled:opacity-50"
          >
            {t("使用增强版本")}
          </button>
        </div>
      }
    >
      {/* 配置行:引擎 + 强度三档 + 开始增强 */}
      <div className="mt-3 flex items-center gap-2">
        <StyledSelect
          value={engineId}
          ariaLabel={t("增强引擎")}
          className="w-36"
          disabled={running}
          onChange={setEngineId}
          options={ENHANCE_ENGINES.map((e) => ({ value: e.id, label: e.id }))}
        />
        {PRESETS.map((p) => (
          <button key={p.id} type="button" className={chip(p.id === preset)} disabled={running} onClick={() => setPreset(p.id)}>
            {p.label}
          </button>
        ))}
        <button
          type="button"
          disabled={running || !original.trim() || !cwd}
          title={
            cwd
              ? fromCacheRef.current
                ? t("当前为缓存结果,再点将重新增强")
                : undefined
              : t("无活跃工作区,无法运行增强")
          }
          onClick={run}
          className="ml-auto flex items-center gap-1.5 rounded bg-(--tmd-accent) px-3 py-1.5 text-xs text-(--tmd-accent-fg) hover:opacity-90 disabled:opacity-50"
        >
          <PlayIcon size="0.75rem" weight="fill" />
          {running ? t("增强中…") : t("开始增强")}
        </button>
      </div>
      <div className="mt-1.5 text-xs text-(--tmd-fg-muted)">{activePreset.hint}</div>

      {/* 高级设置 + 历史切换行 */}
      <div className="mt-2 flex items-center text-xs">
        <button
          type="button"
          className="flex items-center gap-1 text-(--tmd-fg-muted) hover:text-(--tmd-fg)"
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          {advancedOpen ? <CaretDownIcon size="0.75rem" /> : <CaretRightIcon size="0.75rem" />}
          {t("高级设置")}
        </button>
        <button
          type="button"
          className={`ml-4 ${view === "history" ? "text-(--tmd-accent)" : "text-(--tmd-fg-muted) hover:text-(--tmd-fg)"}`}
          onClick={() => setView((v) => (v === "history" ? "panes" : "history"))}
        >
          {t("历史记录")}
        </button>
      </div>
      {advancedOpen && (
        <div className="mt-1.5 flex items-center gap-4 text-xs">
          <label className="flex items-center gap-1.5">
            {t("超时(秒)")}
            <input
              type="number"
              aria-label={t("超时(秒)")}
              min={5}
              max={300}
              value={timeoutSeconds}
              onChange={(e) => {
                const n = e.target.valueAsNumber;
                if (Number.isFinite(n)) setTimeoutSeconds(n);
              }}
              onBlur={() => setTimeoutSeconds(clampTimeoutSeconds(timeoutSeconds))}
              className="w-20 rounded border border-(--tmd-border) bg-(--tmd-bg-elevated) px-2 py-1 text-(--tmd-fg)"
            />
          </label>
          <label className="flex flex-1 items-center gap-1.5">
            {t("模型(留空用 CLI 默认)")}
            <input
              type="text"
              aria-label={t("模型(留空用 CLI 默认)")}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="min-w-0 flex-1 rounded border border-(--tmd-border) bg-(--tmd-bg-elevated) px-2 py-1 font-mono text-(--tmd-fg)"
            />
          </label>
        </div>
      )}

      {view === "history" ? (
        <EnhanceHistory onPick={pickHistory} />
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="flex min-w-0 flex-col">
            <div className="flex items-center gap-1 text-xs text-(--tmd-fg-muted)">
              <PencilSimpleIcon size="0.75rem" />
              {t("原始提示词")}
              <span className="ml-auto">{t("可改")}</span>
            </div>
            <textarea
              aria-label={t("原始提示词")}
              value={original}
              onChange={(e) => setOriginal(e.target.value)}
              className="mt-1.5 h-64 w-full resize-y rounded border border-(--tmd-border) bg-(--tmd-bg-elevated) p-2 text-xs leading-normal text-(--tmd-fg) outline-none focus:border-(--tmd-accent)"
            />
          </div>
          <EnhancedPane
            running={running}
            live={live}
            fail={fail}
            enhanced={enhanced}
            fromCache={fromCache}
            timeoutSeconds={clampTimeoutSeconds(timeoutSeconds)}
          />
        </div>
      )}
    </DialogShell>
  );
}
