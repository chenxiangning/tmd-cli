/**
 * cli-config 复合控件:密钥显隐 / 键值映射表(modelMap) / 有序串链(orderedList)。
 * 全部下拉走 StyledSelect;modelMap 值列在 field.catalog 存在时升级 ModelPicker;
 * 回退链(multi)候选渲染在 ChainPicker.tsx。
 */
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeClosed, Plus, Trash } from "@phosphor-icons/react";
import type {
  CliConfigField,
  CliConfigValues,
  CliModelCatalogProvider,
  CliSelectOption,
} from "@kernel/cliConfigRegistry";
import { StyledSelect } from "@kernel/StyledSelect";
import { t } from "@kernel/i18n";
import { ModelPicker, splitModelValue } from "./ModelPicker";
import { ChainPicker } from "./ChainPicker";

export const strVal = (v: CliConfigValues[string] | undefined): string =>
  typeof v === "string" ? v : "";

/** 候选规整为 StyledSelect 选项(字符串 → {value};函数版收当前表单值)。 */
export function toOptions(
  options: CliConfigField["options"],
  values?: CliConfigValues,
): CliSelectOption[] {
  const resolved =
    typeof options === "function" ? options(values ?? {}) : (options ?? []);
  return (Array.isArray(resolved) ? resolved : []).map((o) =>
    typeof o === "string" ? { value: o } : o,
  );
}

export function withCurrent(options: CliSelectOption[], current: string): CliSelectOption[] {
  const has = (o: CliSelectOption) => (typeof o === "string" ? o : o.value) === current;
  return current && !options.some(has) ? [{ value: current }, ...options] : options;
}

/** StyledSelect 入参规整(联合 → 纯对象)。 */
export const normOptions = (list: CliSelectOption[]): { value: string; label?: string; hint?: string }[] =>
  list.map((o) => (typeof o === "string" ? { value: o } : o));

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
        const keyCtl = field.keyOptions ? (
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
        );
        const delBtn = (
          <button
            type="button"
            className="cli-cfg-icon-btn"
            aria-label={t("删除")}
            onClick={() => onSet(value.filter((_, j) => j !== i))}
          >
            <Trash size={13} />
          </button>
        );
        /* multi(回退链):角色一行、候选若干行、添加候选收尾 —— 纵向分组对齐 */
        if (field.multi) {
          return (
            <div key={`${k}:${i}`} className="cli-cfg-kv-group">
              <div className="cli-cfg-kv-head">
                {keyCtl}
                {delBtn}
              </div>
              <ChainPicker
                value={raw}
                catalog={catalog}
                suffixes={field.suffixOptions}
                onChange={(v) => patch(i, [k, v])}
              />
            </div>
          );
        }
        return (
          <div key={`${k}:${i}`} className="cli-cfg-kv-row">
            {keyCtl}
            {field.catalog ? (
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
                  options={normOptions(withCurrent(toOptions(field.options, values), raw))}
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
            {delBtn}
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
  const candidates = toOptions(field.options);
  return (
    <div className="cli-cfg-kv">
      {value.map((item, i) => (
        <div key={`${item}:${i}`} className="cli-cfg-kv-row">
          {field.options ? (
            <StyledSelect
              value={item}
              options={normOptions(withCurrent(toOptions(field.options), item))}
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
        onClick={() =>
          onSet([...value, strVal(typeof candidates[0] === "string" ? candidates[0] : candidates[0]?.value ?? "")])}
      >
        <Plus size={12} /> {t("添加候选")}
      </button>
    </div>
  );
}
export { splitModelValue };
