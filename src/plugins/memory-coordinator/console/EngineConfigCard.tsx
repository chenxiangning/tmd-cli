/**
 * 引擎配置卡 —— 上游 magic-context.jsonc 的实证项编辑(读/写/脏标)。
 *
 * 只映射上游实证项(spec §8.3):提取/治理引擎模型(historian/dreamer)、
 * 检索增强(sidekick);embedding 为上游默认,未造开关。
 * 模型选择:下拉数据来自 `omp models list --json` 拉取(关联数据,用户免填);
 * 列表不可用时降级手动输入。jsonc 剥注释解析,写回保持 per-harness 形态。
 */

import { useEffect, useState } from "react";
import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { engineConfigPath } from "../paths";
// cli-shared 消费声明:本 feature 插件经共享层消费 CLI 配置 JSONC 格式知识(见 jsonc.ts 头注)。
import { parseJsoncOrNull } from "../../cli-shared/jsonc";
import { listModels, type ModelEntry } from "../modelCatalog";

export interface EngineConfig {
  historianModel: string;
  dreamerModel: string;
  sidekickModel: string;
  sidekickEnabled: boolean;
  embeddingEnabled: boolean;
}

function pickModel(block: unknown): string {
  if (block && typeof block === "object") {
    const omp = (block as Record<string, unknown>).omp as Record<string, unknown> | undefined;
    const pi = (block as Record<string, unknown>).pi as Record<string, unknown> | undefined;
    const any = (omp ?? pi) as Record<string, unknown> | undefined;
    return typeof any?.model === "string" ? any.model : "";
  }
  return "";
}

export function readEngineConfig(raw: Record<string, unknown> | null): EngineConfig {
  return {
    historianModel: pickModel(raw?.historian),
    dreamerModel: pickModel(raw?.dreamer),
    sidekickModel: pickModel(raw?.sidekick),
    sidekickEnabled: raw?.sidekick !== undefined,
    embeddingEnabled: true,
  };
}

/** 引擎配置 → 可写回的 jsonc 文本(per-harness:pi 为基座,omp 回退 pi,opencode 独立)。 */
export function serializeEngineConfig(config: EngineConfig, original: string | null): string {
  const base = parseJsoncOrNull(original ?? "") ?? {};
  const withModel = (block: unknown, model: string): unknown => ({
    ...(typeof block === "object" && block ? (block as Record<string, unknown>) : {}),
    pi: { ...(((block as Record<string, unknown>)?.pi as object) ?? {}), model },
    omp: { ...(((block as Record<string, unknown>)?.omp as object) ?? {}), model },
    opencode: { model },
  });
  base.historian = withModel(base.historian, config.historianModel);
  base.dreamer = withModel(base.dreamer, config.dreamerModel);
  if (config.sidekickEnabled) base.sidekick = withModel(base.sidekick, config.sidekickModel);
  return JSON.stringify(base, null, 2) + "\n";
}

export async function readEngineConfigFile(): Promise<{ config: EngineConfig; original: string }> {
  const p = await engineConfigPath();
  const original = await ipc.fsReadFile(p).catch(() => "");
  return { config: readEngineConfig(parseJsoncOrNull(original)), original };
}

export async function writeEngineConfigFile(
  config: EngineConfig,
  original: string | null,
): Promise<void> {
  const p = await engineConfigPath();
  await ipc.fsWriteFile(p, serializeEngineConfig(config, original));
}

const inputCls =
  "h-7 flex-1 min-w-0 rounded-md border border-(--tmd-border) bg-(--tmd-bg-input) px-2 font-mono text-[0.6875rem] text-(--tmd-fg) outline-none focus:border-(--tmd-accent)";
const selectCls = `${inputCls} cursor-pointer`;
const toggle = (on: boolean) =>
  `h-5 w-[30px] flex-none rounded-full border relative ${
    on ? "border-(--tmd-accent) bg-(--tmd-accent-soft)" : "border-(--tmd-border-strong) bg-(--tmd-bg-input)"
  }`;
const knob = (on: boolean) =>
  `absolute top-1/2 h-[11px] w-[11px] -translate-y-1/2 rounded-full ${
    on ? "left-[14px] bg-(--tmd-accent)" : "left-[2px] bg-(--tmd-fg-faint)"
  }`;

/** 模型选择器:omp 数据下拉 + 自定义输入兜底(手动填 selector)。 */
function ModelSelect({
  value,
  models,
  loading,
  onChange,
}: {
  value: string;
  models: ModelEntry[];
  loading: boolean;
  onChange: (v: string) => void;
}) {
  const [manual, setManual] = useState(false);
  const inList = models.some((m) => m.selector === value);
  const showSelect = !manual && (models.length > 0 || !value);

  if (loading) {
    return <span className="truncate text-[0.6875rem] text-(--tmd-fg-faint)">{t("拉取模型列表中…")}</span>;
  }
  if (showSelect && models.length === 0) {
    return (
      <div className="flex w-full min-w-0 flex-col gap-1">
        <span className="truncate text-[0.65625rem] text-(--tmd-fg-subtle)" title={t("无法拉取模型列表(检查 omp 是否可用),仍可手动填写 selector")}>
          {t("无法拉取模型列表(检查 omp 是否可用),仍可手动填写 selector")}
        </span>
        <input className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    );
  }
  return (
    <div className="flex flex-1 min-w-0 flex-col gap-1">
      {showSelect ? (
        <select className={`${selectCls} cursor-pointer`} value={value} onChange={(e) => onChange(e.target.value)}>
          {value && !inList && <option value={value}>{t("{model}(当前)", { model: value })}</option>}
          {models.map((m) => (
            <option key={m.selector} value={m.selector}>
              {m.selector}
              {m.reasoning ? t(" · 可思考") : ""}
              {m.contextWindow ? ` · ${Math.round(m.contextWindow / 1024)}K` : ""}
            </option>
          ))}
        </select>
      ) : (
        <input className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      <button
        className="flex-none self-start text-[0.625rem] text-(--tmd-fg-faint) hover:text-(--tmd-fg-muted)"
        onClick={() => setManual(!manual)}
      >
        {manual ? t("← 返回列表选择") : t("手动填写 selector")}
      </button>
    </div>
  );
}

export function EngineConfigCard({
  config,
  dirty,
  saving,
  onChange,
  onSave,
}: {
  config: EngineConfig;
  dirty: boolean;
  saving: boolean;
  onChange: (next: EngineConfig) => void;
  onSave: () => void;
}) {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);

  useEffect(() => {
    void listModels("omp").then((m) => {
      setModels(m);
      setModelsLoading(false);
    });
  }, []);

  const modelRow = (label: string, hint: string, key: "historianModel" | "dreamerModel") => (
    <div className="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1">
      <span className="w-20 flex-none pt-0.5 text-[0.6875rem] text-(--tmd-fg-muted)">
        {label} <span className="block text-[0.59375rem] text-(--tmd-fg-faint)">{hint}</span>
      </span>
      <ModelSelect
        value={config[key]}
        models={models}
        loading={modelsLoading}
        onChange={(v) => onChange({ ...config, [key]: v })}
      />
    </div>
  );
    return (
    <div className="rounded-lg border border-(--tmd-border) bg-(--tmd-bg-elevated) p-3">
      <div className="mb-0.5 text-[0.71875rem] font-semibold">{t("引擎(上游模型分工)")}</div>
      <div className="mb-2 text-[0.625rem] text-(--tmd-fg-faint)">
        {t("决定 Magic Context 用哪个模型干活;保存后写入其全局配置(magic-context.jsonc),对所有项目生效。模型列表实时取自 omp 可用模型。")}
      </div>
      <div className="flex flex-col gap-2">
        {modelRow(t("提取引擎"), t("historian · 压缩历史时提炼记忆,选便宜快的"), "historianModel")}
        {modelRow(t("治理引擎"), t("dreamer · 夜间整理去重,不在前台跑"), "dreamerModel")}
        <div className="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1">
          <span className="w-20 flex-none pt-0.5 text-[0.6875rem] text-(--tmd-fg-muted)">
            {t("检索增强")} <span className="block text-[0.59375rem] text-(--tmd-fg-faint)">{t("sidekick · omp 会话内 /ctx-aug")}</span>
          </span>
          <div className="flex flex-none flex-col gap-1">
            <button className={toggle(config.sidekickEnabled)} onClick={() => onChange({ ...config, sidekickEnabled: !config.sidekickEnabled })}>
              <span className={knob(config.sidekickEnabled)} />
            </button>
          </div>
          {config.sidekickEnabled && (
            <div className="w-full min-w-0 pl-[88px]">
              <ModelSelect
                value={config.sidekickModel}
                models={models}
                loading={modelsLoading}
                onChange={(v) => onChange({ ...config, sidekickModel: v })}
              />
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="w-20 flex-none text-[0.6875rem] text-(--tmd-fg-muted)">
            {t("向量索引")} <span className="block text-[0.59375rem] text-(--tmd-fg-faint)">embedding</span>
          </span>
          <span className="min-w-0 flex-1 truncate text-[0.65625rem] text-(--tmd-fg-subtle)" title={t("本地 MiniLM(上游默认;关闭则仅关键词检索)")}>{t("本地 MiniLM(上游默认;关闭则仅关键词检索)")}</span>
        </div>
        {dirty && (
          <div className="mt-1 flex flex-none items-center gap-2">
            <button
              className="flex-none rounded-md border border-(--tmd-accent) bg-(--tmd-accent) px-3 py-1 text-[0.6875rem] text-(--tmd-accent-fg) disabled:opacity-45"
              disabled={saving}
              onClick={onSave}
            >
              {saving ? t("保存中…") : t("保存配置")}
            </button>
            <span className="text-[0.65625rem] text-(--tmd-warn)">{t("有未保存修改")}</span>
          </div>
        )}
        <div className="mt-1 truncate text-[0.625rem] text-(--tmd-fg-faint)" title={t("其余项以 magic-context.jsonc 为准,未造配置")}>
          {t("其余项以 magic-context.jsonc 为准,未造配置")}
        </div>
      </div>
    </div>
  );
}
