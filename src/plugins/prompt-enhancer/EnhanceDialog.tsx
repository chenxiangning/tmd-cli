/**
 * 增强对话框 —— 并排对照(图 2 交互,spec 2026-09-21):
 * 引擎选择 + 强度三档 + 开始增强;高级设置折叠(超时/模型);左原始可改、右增强只读;
 * 底部保留原始版本 / 使用增强版本(整替草稿经 composerReplaceRef)。
 */

import { useState } from "react";
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

const PRESETS: Array<{ id: EnhancePreset; label: string; hint: string }> = [
  { id: "light", label: t("轻润色"), hint: t("只整理措辞,短句不扩写") },
  { id: "structured", label: t("结构化"), hint: t("分小节重组,不虚构事实") },
  { id: "executable", label: t("可执行"), hint: t("压成短句清单,只留约束与交付格式") },
];

function failCopy(fail: Extract<EnhanceOutcome, { ok: false }>, timeoutSeconds: number): string {
  switch (fail.kind) {
    case "timeout":
      return t("增强超时({seconds} 秒),可重试或调大超时", { seconds: timeoutSeconds });
    case "empty":
      return t("引擎返回空结果,请重试");
    case "engine":
      return `${t("增强失败")}${fail.detail ? `: ${fail.detail}` : ""}`;
  }
}

/** 增强右栏:状态标签 + 只读结果体(错误红字 / 等待空态),从主件拆出降复杂度。 */
function EnhancedPane({
  running,
  fail,
  enhanced,
  timeoutSeconds,
}: {
  running: boolean;
  fail: Extract<EnhanceOutcome, { ok: false }> | null;
  enhanced: string;
  timeoutSeconds: number;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-center gap-1 text-xs text-(--tmd-fg-muted)">
        <SparkleIcon size="0.75rem" className="text-(--tmd-accent)" />
        {t("增强后的提示词")}
        <span className="ml-auto">
          {running ? t("增强中…") : fail ? t("增强失败") : enhanced ? "" : t("等待增强")}
        </span>
      </div>
      <textarea
        readOnly
        aria-label={t("增强后的提示词")}
        value={running ? "" : fail ? failCopy(fail, timeoutSeconds) : enhanced}
        className={`mt-1.5 h-64 w-full resize-y rounded border p-2 text-xs leading-normal outline-none ${
          fail
            ? "border-(--tmd-border) text-[#f85149]"
            : "border-(--tmd-accent) bg-(--tmd-bg-elevated) text-(--tmd-fg)"
        }`}
      />
    </div>
  );
}

export function EnhanceDialog({
  cwd,
  initialDraft,
  onClose,
}: {
  cwd: string;
  initialDraft: string;
  onClose: () => void;
}) {
  const [engineId, setEngineId] = useState("claude");
  const [preset, setPreset] = useState<EnhancePreset>("light");
  const [original, setOriginal] = useState(initialDraft);
  const [enhanced, setEnhanced] = useState("");
  const [running, setRunning] = useState(false);
  const [fail, setFail] = useState<Extract<EnhanceOutcome, { ok: false }> | null>(null);
  const [timeoutSeconds, setTimeoutSeconds] = useState(60);
  const [model, setModel] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const activePreset = PRESETS.find((p) => p.id === preset) ?? PRESETS[0];

  const run = async () => {
    if (running || !original.trim() || !cwd) return;
    setRunning(true);
    setFail(null);
    setEnhanced("");
    const out = await runEnhance({
      engineId,
      draft: original,
      preset,
      model: model.trim() || null,
      cwd,
      timeoutSeconds,
    });
    setRunning(false);
    if (out.ok) setEnhanced(out.text);
    else setFail(out);
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
          title={cwd ? undefined : t("无活跃工作区,无法运行增强")}
          onClick={run}
          className="ml-auto flex items-center gap-1.5 rounded bg-(--tmd-accent) px-3 py-1.5 text-xs text-(--tmd-accent-fg) hover:opacity-90 disabled:opacity-50"
        >
          <PlayIcon size="0.75rem" weight="fill" />
          {running ? t("增强中…") : t("开始增强")}
        </button>
      </div>
      <div className="mt-1.5 text-xs text-(--tmd-fg-muted)">{activePreset.hint}</div>

      {/* 高级设置折叠:超时 / 模型 */}
      <button
        type="button"
        className="mt-2 flex items-center gap-1 text-xs text-(--tmd-fg-muted) hover:text-(--tmd-fg)"
        onClick={() => setAdvancedOpen((v) => !v)}
      >
        {advancedOpen ? <CaretDownIcon size="0.75rem" /> : <CaretRightIcon size="0.75rem" />}
        {t("高级设置")}
      </button>
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

      {/* 并排双栏:原始可改 / 增强只读 */}
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
          fail={fail}
          enhanced={enhanced}
          timeoutSeconds={clampTimeoutSeconds(timeoutSeconds)}
        />
      </div>
    </DialogShell>
  );
}
