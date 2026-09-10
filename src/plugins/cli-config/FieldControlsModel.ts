/**
 * cli-config 控件模型:纯函数与钩子,自 FieldControls/ModelPicker 拆出(only-export-components)。
 * 值规整(strVal)/ 候选规整(toOptions/withCurrent/normOptions)/ 目录加载(useCatalog)/
 * 模型串拆分(splitModelValue)/ 可编辑列表行键(rowKey)。
 */
import { useEffect, useState } from "react";
import type {
  CliConfigField,
  CliConfigValues,
  CliModelCatalogProvider,
  CliSelectOption,
} from "@kernel/cliConfigRegistry";

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

export function splitModelValue(value: string): { provider: string; model: string; suffix: string } {
  const slash = value.indexOf("/");
  const provider = slash < 0 ? "" : value.slice(0, slash);
  const rest = slash < 0 ? value : value.slice(slash + 1);
  const colon = rest.indexOf(":");
  return {
    provider,
    model: colon < 0 ? rest : rest.slice(0, colon),
    suffix: colon < 0 ? "" : rest.slice(colon + 1),
  };
}

/** 可编辑列表的行键:内容 + 出现序号。列表允许重复项(如两个空行),纯内容键会撞 key;
 *  编辑/删除导致的键变化与原先 index 参与 key 的行为一致。seen 每次渲染新建。 */
export function rowKey(content: string, seen: Map<string, number>): string {
  const n = seen.get(content) ?? 0;
  seen.set(content, n + 1);
  return n === 0 ? content : `${content}#${n}`;
}
