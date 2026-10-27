/**
 * 体检视图 · 头部条(返回 + 引擎/模型下拉 + 体检 + 完整报告)。
 * 模型下拉与工作台默认引擎条同口径:目录拉得到 = 实况下拉,拉不到/引擎无目录 =
 * 「跟随引擎默认模型」,不设手填(2026-10-13 用户裁定)。
 */

import { useEffect, useState } from "react";
import { ArrowLeft, FileText, Pulse } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { Spinner } from "@kernel/Spinner";
import { StyledSelect } from "@kernel/StyledSelect";
import { listModels, type ModelEntry } from "../modelCatalog";
import { openLintReport } from "./lintController";
import { JUDGE_ENGINES } from "./aiJudge";

const CATALOG_ENGINES: Record<string, true> = { omp: true, pi: true, opencode: true };

/** 模型下拉:目录实时拉取(10 分钟缓存),引擎切换清空选择回默认。 */
function ModelSelect({ engineId, model, onChange }: { engineId: string; model: string; onChange: (v: string) => void }) {
  const [models, setModels] = useState<ModelEntry[] | null>(null);
  const supported = CATALOG_ENGINES[engineId] === true;
  useEffect(() => {
    if (!supported) {
      setModels(null);
      return;
    }
    let cancelled = false;
    setModels(null);
    void listModels(engineId as "omp").then((m) => {
      if (!cancelled) setModels(m); /* 慢引擎迟到丢弃:引擎已切走不错配旧目录 */
    });
    return () => {
      cancelled = true;
    };
  }, [engineId, supported]);
  const options = [{ value: "", label: t("跟随 {engine} 默认模型", { engine: engineId }) }];
  for (const m of models ?? []) options.push({ value: m.selector, label: m.selector });
  if (model && !options.some((o) => o.value === model)) options.push({ value: model, label: model }); /* 存量手填值如实展示,可改回默认 */
  return (
    <StyledSelect
      value={model}
      onChange={onChange}
      ariaLabel={t("默认模型")}
      className="min-w-0 flex-1"
      options={options}
      disabled={!supported && !model}
    />
  );
}

export function LintHeaderBar({
  engineId, model, running, cwd, setEngineId, setModel, onStart, onBack,
}: {
  engineId: string; model: string; running: boolean; cwd: string | null;
  setEngineId: (v: string) => void; setModel: (v: string) => void; onStart: () => void; onBack: () => void;
}) {
  return (
    <div className="flex flex-none items-center gap-1.5 px-1.5 py-1.5">
      <button type="button" onClick={onBack} title={t("返回列表")} className="flex-none rounded p-0.5 text-(--tmd-fg-muted) transition-colors hover:text-(--tmd-accent)">
        <ArrowLeft aria-hidden />
      </button>
      <StyledSelect
        value={engineId}
        onChange={(v) => {
          setEngineId(v);
          setModel(""); /* 引擎切换 = 旧模型目录失效,回默认 */
        }}
        ariaLabel={t("判定引擎")}
        className="min-w-0 flex-none"
        options={JUDGE_ENGINES.map((e) => ({ value: e.id, label: e.id }))}
      />
      <ModelSelect engineId={engineId} model={model} onChange={setModel} />
      <button
        type="button"
        onClick={onStart}
        disabled={running || !cwd}
        className="flex-none rounded border border-(--tmd-border) px-2 py-0.5 text-meta text-(--tmd-fg-muted) transition-colors hover:border-(--tmd-accent) hover:text-(--tmd-accent) disabled:opacity-50"
        title={t("第一步脚本扫描逐条上屏;第二步完整配置发 AI 逐条识别")}
      >
        <span className="inline-flex items-center gap-1">
          {running ? <Spinner /> : <Pulse aria-hidden />}
          {t("体检")}
        </span>
      </button>
      <button
        type="button"
        onClick={() => openLintReport()}
        disabled={!cwd}
        title={t("在中央区打开完整报告:分区规则/扫描记录/应用记录")}
        className="flex-none rounded border border-(--tmd-border) p-1 text-(--tmd-fg-muted) transition-colors hover:border-(--tmd-accent) hover:text-(--tmd-accent) disabled:opacity-50"
      >
        <FileText aria-hidden />
      </button>
    </div>
  );
}
