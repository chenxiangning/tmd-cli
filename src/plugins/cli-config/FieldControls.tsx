/**
 * cli-config 复合控件:密钥显隐 / 键值映射表(modelMap) / 有序串链(orderedList)。
 * 全部下拉走 StyledSelect;modelMap 值列在 field.catalog 存在时升级 ModelPicker。
 */

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, CaretDown, CaretUp, Eye, EyeClosed, Plus, Trash } from "@phosphor-icons/react";
import type {
  CliConfigField,
  CliConfigValues,
  CliModelCatalogProvider,
} from "@kernel/cliConfigRegistry";
import { StyledSelect } from "@kernel/StyledSelect";
import { t } from "@kernel/i18n";
import { ModelPicker, splitModelValue } from "./ModelPicker";

export const strVal = (v: CliConfigValues[string] | undefined): string =>
  typeof v === "string" ? v : "";

/** 候选并上当前值(磁盘里有、候选里没有也要能显示)。 */
export function optionsWithCurrent(
  options: CliConfigField["options"],
  current: string,
  values?: CliConfigValues,
): string[] {
  const resolved =
    typeof options === "function" ? options(values ?? {}) : (options ?? []);
  const base = Array.isArray(resolved) ? resolved : [];
  return current && !base.includes(current) ? [current, ...base] : base;
}

/** field.catalog 加载钩子:每表单实例一次。 */
export function useCatalog(field: CliConfigField): CliModelCatalogProvider[] | null {
  const [catalog, setCatalog] = useState<CliModelCatalogProvider[] | null>(null);
  useEffect(() => {
    if (!field.catalog) return;
    let cancelled = false;
    void field.catalog().then((c) => {
      if (!cancelled) setCatalog(c);
    });
    return () => {
      cancelled = true;
    };
  }, [field]);
  return field.catalog ? catalog : null;
}

/** 密钥输入:默认掩码,眼睛切换明文。 */
export function SecretInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="cli-cfg-secret">
      <input
        id={id}
        type={show ? "text" : "password"}
        className="cli-cfg-input"
        value={value}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="cli-cfg-icon-btn"
        aria-label={show ? t("隐藏") : t("显示")}
        onClick={() => setShow(!show)}
      >
        {show ? <Eye size={13} /> : <EyeClosed size={13} />}
      </button>
    </div>
  );
}

/** 键值映射表:值列 = 目录两级选择器 / 候选下拉 / 自由文本;键可下拉可自由。 */
export function ModelMapInput({
  field,
  value,
  onSet,
  values,
}: {
  field: CliConfigField;
  value: Array<[string, string]>;
  onSet: (v: Array<[string, string]>) => void;
  values: CliConfigValues;
}) {
  const catalog = useCatalog(field);
  const patch = (i: number, row: [string, string]) =>
    onSet(value.map((r, j) => (j === i ? row : r)));
  return (
    <div className="cli-cfg-kv">
      {value.map(([k, raw], i) => {
        return (
          <div key={`${k}:${i}`} className="cli-cfg-kv-row">
            {field.keyOptions ? (
              <StyledSelect
                className="is-key"
                value={k}
                options={field.keyOptions.map((o) => ({ value: o }))}
                onChange={(v) => patch(i, [v, raw])}
              />
            ) : (
              <input
                className="cli-cfg-input is-key"
                value={k}
                placeholder={t("键")}
                onChange={(e) => patch(i, [e.target.value, raw])}
              />
            )}
            {field.catalog && field.multi ? (
              <ChainPicker
                value={raw}
                catalog={catalog}
                suffixes={field.suffixOptions}
                onChange={(v) => patch(i, [k, v])}
              />
            ) : field.catalog ? (
              <ModelPicker
                value={raw}
                catalog={catalog}
                suffixes={field.suffixOptions}
                onChange={(v) => patch(i, [k, v])}
              />
            ) : field.options ? (
              <div className="cli-cfg-kv-value">
                <StyledSelect
                  value={raw}
                  options={optionsWithCurrent(field.options, raw, values).map((o) => ({
                    value: o,
                  }))}
                  onChange={(v) => patch(i, [k, v])}
                />
              </div>
            ) : (
              <input
                className="cli-cfg-input"
                value={raw}
                onChange={(e) => patch(i, [k, e.target.value])}
              />
            )}
            <button
              type="button"
              className="cli-cfg-icon-btn"
              aria-label={t("删除")}
              onClick={() => onSet(value.filter((_, j) => j !== i))}
            >
              <Trash size={13} />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="cli-cfg-add"
        onClick={() => onSet([...value, [field.keyOptions?.[0] ?? "", ""]])}
      >
        <Plus size={12} /> {t("添加")}
      </button>
    </div>
  );
}

/** 有序串链:值 = 逗号分隔,顺序即优先级。 */
export function OrderedListInput({
  field,
  value,
  onSet,
}: {
  field: CliConfigField;
  value: string[];
  onSet: (v: string[]) => void;
}) {
  const patch = (i: number, item: string) => onSet(value.map((x, j) => (j === i ? item : x)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onSet(next);
  };
  const candidates = optionsWithCurrent(field.options, "");
  return (
    <div className="cli-cfg-kv">
      {value.map((item, i) => (
        <div key={`${item}:${i}`} className="cli-cfg-kv-row">
          {field.options ? (
            <StyledSelect
              value={item}
              options={optionsWithCurrent(field.options, item).map((o) => ({ value: o }))}
              onChange={(v) => patch(i, v)}
            />
          ) : (
            <input
              className="cli-cfg-input"
              value={item}
              onChange={(e) => patch(i, e.target.value)}
            />
          )}
          <button
            type="button"
            className="cli-cfg-icon-btn"
            aria-label={t("上移")}
            disabled={i === 0}
            onClick={() => move(i, -1)}
          >
            <ArrowUp size={12} />
          </button>
          <button
            type="button"
            className="cli-cfg-icon-btn"
            aria-label={t("下移")}
            disabled={i === value.length - 1}
            onClick={() => move(i, 1)}
          >
            <ArrowDown size={12} />
          </button>
          <button
            type="button"
            className="cli-cfg-icon-btn"
            aria-label={t("删除")}
            onClick={() => onSet(value.filter((_, j) => j !== i))}
          >
            <Trash size={13} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="cli-cfg-add"
        onClick={() => onSet([...value, candidates[0] ?? ""])}
      >
        <Plus size={12} /> {t("添加候选")}
      </button>
    </div>
  );
}

/** 有序模型链:值 = 逗号分隔的 "provider/model[:suffix]" 序列,每项两级选择器。 */
function ChainPicker({
  value,
  catalog,
  suffixes,
  onChange,
}: {
  value: string;
  catalog: CliModelCatalogProvider[] | null;
  suffixes?: string[];
  onChange: (v: string) => void;
}) {
  /* 保留空串项:新加的候选要显示成可配置的空选择器;落盘前 save 端会过滤空值 */
  const items = value.split(",").map((s) => s.trim());
  const commit = (next: string[]) => onChange(next.join(","));
  const patch = (i: number, item: string) => commit(items.map((x, j) => (j === i ? item : x)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };
  return (
    <div className="cli-cfg-kv cli-cfg-chain">
      {items.map((item, i) => (
        <div key={`${item}:${i}`} className="cli-cfg-kv-row">
          <ModelPicker value={item} catalog={catalog} suffixes={suffixes} onChange={(v) => patch(i, v)} />
          <span className="cli-cfg-chain-ctl">
            <button type="button" className="cli-cfg-icon-btn" aria-label={t("上移")} disabled={i === 0}
              onClick={() => move(i, -1)}>
              <CaretUp size={12} />
            </button>
            <button type="button" className="cli-cfg-icon-btn" aria-label={t("下移")} disabled={i === items.length - 1}
              onClick={() => move(i, 1)}>
              <CaretDown size={12} />
            </button>
            <button type="button" className="cli-cfg-icon-btn" aria-label={t("删除")}
              onClick={() => commit(items.filter((_, j) => j !== i).filter(Boolean))}>
              <Trash size={13} />
            </button>
          </span>
        </div>
      ))}
      <button type="button" className="cli-cfg-add" onClick={() => commit([...items, ""])}>
        <Plus size={12} /> {t("添加候选")}
      </button>
    </div>
  );
}

export { splitModelValue };
