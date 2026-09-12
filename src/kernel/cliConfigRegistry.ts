/**
 * CLI 配置贡献注册表 —— 「CLI 独立配置」设置 section 的扩展点。
 *
 * 各 cli-* 插件经 ctx.registerCliConfig 贡献一份引擎配置面;渲染归
 * plugins/cli-config(通用表单 + 复合控件),格式知识(load/save 纯函数)留插件侧。
 * 注册表本身不渲染、不含任何 CLI 私有知识。未注册 = 引擎 tab 不出现。
 */

import type { ReactNode } from "react";
import { createSubscribable } from "./subscribable";

/** 单选项(字符串或带显示名/备注)。 */
export type CliSelectOption = string | { value: string; label?: string; hint?: string };

/** 「供应商 → 模型」候选目录:插件从 CLI 登录态/目录文件实况组装,UI 不内置任何模型表。 */
export interface CliModelCatalogProvider {
  id: string;
  label?: string;
  models: Array<{ id: string; label?: string; suffixes?: string[] }>;
  /** true = 已登录/已配置(徽标 + 排序在前)。 */
  authed?: boolean;
  /** 徽标文案覆盖(如「已配置」);缺省按 authed 取「已登录/未登录」。 */
  badge?: string;
}

/** 控件类型:基础四件 + 两个复合(modelMap 键值映射表 / orderedList 有序串链)。 */
type CliConfigFieldKind = "text" | "select" | "toggle" | "secret" | "modelMap" | "orderedList";

export interface CliConfigField {
  /** 表单值对象里的键(插件 load/save 自决与磁盘键的映射)。 */
  id: string;
  label: string;
  kind: CliConfigFieldKind;
  /** 新手向长说明:解决什么问题、影响什么;存在时行内可展开,按 \n 分段。 */
  detail?: string;
  /** modelMap 专用:值 = 有序多个模型引用(如回退链),每个候选用两级选择器。 */
  multi?: boolean;
  /** select 候选;函数版收当前表单值(级联:服务商→模型;磁盘候选 load 后刷新)。 */
  options?: CliSelectOption[] | ((values: CliConfigValues) => CliSelectOption[] | Promise<CliSelectOption[]>);
  /** modelMap:键下拉候选(如 omp 角色名);缺省 = 自由文本键。 */
  keyOptions?: string[];
  /** modelMap:值 = 模型[:后缀] 时,后缀下拉候选(如思考强度);缺省 = 值整体单输入。 */
  suffixOptions?: string[];
  /** 「供应商 → 模型」实况目录:存在时 select / modelMap 值列升级为两级选择器;
   *  值格式仍为 "provider/model[:suffix]"。 */
  catalog?: () => Promise<CliModelCatalogProvider[]>;
  /** 收进「高级」折叠区。 */
  advanced?: boolean;
}

export interface CliConfigValues {
  [fieldId: string]: string | boolean | Array<[string, string]> | string[];
}

/** 配置源(全局 / 项目级 overlay);exists=false 时首次保存创建。 */
export interface CliConfigSource {
  id: string;
  label: string;
  path: string;
  exists: boolean;
  /** 源专属提示行(如项目级数组整体替换语义)。 */
  note?: string;
}

export interface CliConfigEntry {
  /** 全局唯一,约定 = CliProfile.id(如 "omp")。 */
  id: string;
  title: string;
  /** 引擎图标(子 tab 条用;复用 profile.renderIcon 的 rem 尺寸)。 */
  icon?: (size: string) => ReactNode;
  /** 排序,小的在前。 */
  order?: number;
  /** 配置源列表(单源插件给一项);至少一项。 */
  sources: () => Promise<CliConfigSource[]>;
  fields: CliConfigField[];
  /** 字段表单下方的附加面板(供应商渠道等);泛型扩展位,内核不知具体语义。 */
  providerPanel?: () => ReactNode;
  /** 原始编辑逃生舱的语言名(如 "yaml");缺省 = 无原始模式。 */
  rawEditor?: string;
  /** rawText → 表单值(解析失败抛错,UI 显错误态)。 */
  load: (rawText: string) => CliConfigValues;
  /** rawText + 表单值 → 新 rawText(行级补丁/合并,格式知识在插件侧)。 */
  save: (rawText: string, values: CliConfigValues) => string;
}

const entries = new Map<string, CliConfigEntry>();
const store = createSubscribable<CliConfigEntry[]>([]);

function sorted(): CliConfigEntry[] {
  return [...entries.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** 注册一份引擎配置面。重复 id 视为冲突(插件 bug),直接抛错。 */
export function registerCliConfig(entry: CliConfigEntry): void {
  if (entries.has(entry.id)) {
    throw new Error(`CLI 配置重复注册: ${entry.id}`);
  }
  entries.set(entry.id, entry);
  store.commit(sorted());
}

/** 撤销通道(激活失败回滚/熔断摘除):id 未存在时静默(幂等)。 */
export function removeCliConfig(id: string): void {
  if (!entries.delete(id)) return;
  store.commit(sorted());
}

export function useCliConfigEntries(): CliConfigEntry[] {
  return store.useStore();
}
