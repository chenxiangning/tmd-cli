/**
 * ModelPicker —— 「供应商 → 模型(:思考后缀)」两级/三级选择器。
 *
 * 设置(目录来源)与选择(两级挑选)分离;值串拆分 splitModelValue 在 FieldControlsModel.ts。
 */

import type { CliModelCatalogProvider } from "@kernel/cliConfigRegistry";
import { StyledSelect } from "@kernel/StyledSelect";
import { t } from "@kernel/i18n";
import { splitModelValue } from "./FieldControlsModel";

export function ModelPicker({
  value,
  catalog,
  suffixes,
  onChange,
}: {
  value: string;
  /** null = 目录加载中。 */
  catalog: CliModelCatalogProvider[] | null;
  /** 后缀候选(思考强度);缺省 = 值只有 供应商/模型 两级。 */
  suffixes?: string[];
  onChange: (value: string) => void;
}) {
  const { provider, model, suffix } = splitModelValue(value);
  const providers = catalog ?? [];

  const providerOptions = [
    ...(provider && !providers.some((p) => p.id === provider)
      ? [{ value: provider, hint: t("当前值") }]
      : []),
    ...providers.map((p) => ({
      value: p.id,
      label: p.label ?? p.id,
      hint: p.badge ?? (p.authed ? t("已登录") : undefined),
    })),
  ];

  const active = providers.find((p) => p.id === provider);
  const modelOptions = [
    ...(model && !(active?.models ?? []).some((m) => m.id === model)
      ? [{ value: model, hint: t("当前值") }]
      : []),
    ...(active?.models ?? []).map((m) => ({ value: m.id, label: m.label ?? m.id })),
  ];
  const activeModel = active?.models.find((m) => m.id === model);
  const suffixOptions = activeModel?.suffixes ?? suffixes ?? [];

  const compose = (p: string, m: string, s: string) =>
    `${p}/${m}${suffixes && s ? `:${s}` : ""}`;

  return (
    <div className="cli-cfg-modelpicker">
      <StyledSelect
        value={provider}
        options={providerOptions}
        disabled={!catalog}
        placeholder={t("供应商")}
        onChange={(p) => {
          const next = providers.find((x) => x.id === p);
          onChange(compose(p, next?.models[0]?.id ?? "", suffix));
        }}
      />
      <StyledSelect
        value={model}
        options={modelOptions}
        disabled={!catalog || !provider}
        placeholder={t("模型")}
        onChange={(m) => onChange(compose(provider, m, suffix))}
      />
      {suffixes && (
        <StyledSelect
          value={suffix}
          options={suffixOptions.map((s) => ({ value: s }))}
          disabled={!provider}
          placeholder={t("强度")}
          onChange={(s) => onChange(compose(provider, model, s))}
        />
      )}
    </div>
  );
}
