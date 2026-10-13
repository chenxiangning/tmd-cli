/**
 * 概览页 · 默认会话引擎选择条(workbenchDefaultEngine / workbenchEngineModels,
 * kernel settings 即时生效)。CLI 未选 = 不固定(既有行为:跟随该目录最近会话);
 * 模型行按引擎能力门控:目录拉得到 = 下拉(omp/pi/opencode 实况目录),拉不到 =
 * 直接显示「使用 {engine} 默认模型」,不设手填(口径见 2026-10-13 用户裁定);
 * 无 modelArg/oneshotArgs 声明的引擎模型传不进去,输入禁用;慢引擎迟到列表丢弃。
 */
import { useEffect, useState } from "react";
import { t } from "@kernel/i18n";
import { updateSettings, useSettingsState } from "@kernel/settings";
/* 跨插件消费 memory-coordinator 声明的纯数据拉取(先例同 journal/GenSettings
 * 模型下拉):引擎模型目录单一真相源,不涉其生命周期。 */
import { listModels } from "@plugins/memory-coordinator/modelCatalog";
import { defaultEngineCandidates } from "../defaultEngine";

/** 模型行三分:锁定(引擎不支持指定)/ 目录下拉 / 使用默认(目录拉取不到,不设手填)。 */
function ModelControl({ engineId, modelLocked, model, models, modelsLoading, onChange }: {
  engineId: string;
  modelLocked: boolean;
  model: string;
  models: { selector: string }[];
  modelsLoading: boolean;
  onChange: (v: string) => void;
}) {
  if (modelLocked) {
    const why = t("{engine} 未声明 modelArg/无头模板,模型不可指定(用引擎默认)", { engine: engineId });
    return <input className="wb-engbar-sel wb-engbar-model" value="" disabled aria-label={t("默认模型")} title={why} placeholder={why} />;
  }
  if (models.length === 0) {
    return (
      <select
        className="wb-engbar-sel wb-engbar-model"
        disabled
        aria-label={t("默认模型")}
        title={modelsLoading ? t("拉取模型列表中…") : undefined}
      >
        <option>{modelsLoading ? t("拉取模型列表中…") : t("使用 {engine} 默认模型", { engine: engineId })}</option>
      </select>
    );
  }
  return (
    <select
      className="wb-engbar-sel wb-engbar-model"
      aria-label={t("默认模型")}
      value={model}
      title={t("列表实时取自 {engine} 可用模型", { engine: engineId })}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{t("跟随 {engine} 默认模型", { engine: engineId })}</option>
      {models.map((m) => (
        <option key={m.selector} value={m.selector}>{m.selector}</option>
      ))}
    </select>
  );
}

export function DefaultEngineBar() {
  const { settings } = useSettingsState();
  const engines = defaultEngineCandidates();
  /* 存量指向已不在候选集(插件拔出/降级)也如实显示,用户可当场改回。 */
  const engineId = settings.workbenchDefaultEngine;
  const known = engines.some((p) => p.id === engineId);
  const profile = engines.find((p) => p.id === engineId);
  /* 模型可指定 = modelArg(--model 声明制)或 oneshotArgs(无头模板内嵌 model),GenSettings 同门。 */
  const modelLocked = !!profile && !profile.modelArg && !profile.oneshotArgs;
  const model = engineId ? (settings.workbenchEngineModels[engineId] ?? "") : "";
  const [models, setModels] = useState<{ selector: string }[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  /* 可拉目录的引擎 id(null = 未选引擎/模型锁定,不发起拉取)。 */
  const fetchEngine = profile && !modelLocked ? profile.id : null;
  useEffect(() => {
    if (!fetchEngine) {
      setModels([]);
      setModelsLoading(false);
      return;
    }
    let cancelled = false;
    setModelsLoading(true);
    void listModels(fetchEngine as "omp")
      .then((m) => {
        /* 慢引擎迟到列表丢弃:引擎已切走后落地会把下拉错配到旧引擎(GenSettings MC10 同款)。 */
        if (!cancelled) {
          setModels(m);
          setModelsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchEngine]);

  const setEngine = (id: string) => updateSettings({ workbenchDefaultEngine: id });
  const setModel = (v: string) =>
    updateSettings({ workbenchEngineModels: { ...settings.workbenchEngineModels, [engineId]: v } });

  return (
    <div className="wb-engbar">
      <span className="wb-engbar-label">{t("默认会话 CLI")}</span>
      <select
        className="wb-engbar-sel"
        aria-label={t("默认会话 CLI")}
        value={engineId}
        title={t("「开会话」「在此目录开新会话」「生成文档」等工作台发起的会话默认用它;不固定 = 跟随该目录最近会话。")}
        onChange={(e) => setEngine(e.target.value)}
      >
        <option value="">{t("不固定(跟随该目录最近会话)")}</option>
        {engines.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
        {!known && engineId ? <option value={engineId}>{engineId}</option> : null}
      </select>
      {engineId ? (
        <>
          <span className="wb-engbar-label">{t("默认模型")}</span>
          <ModelControl
            engineId={engineId}
            modelLocked={modelLocked}
            model={model}
            models={models}
            modelsLoading={modelsLoading}
            onChange={setModel}
          />
        </>
      ) : null}
    </div>
  );
}
