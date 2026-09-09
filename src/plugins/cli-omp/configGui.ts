/**
 * omp 图形化配置面 —— config.yml 的 schema + 行级补丁 load/save 纯函数。
 *
 * 格式知识(YAML 键路径、models.yml 目录解析、角色表)全部留本插件;
 * 渲染归 cli-config 通用表单。写回纪律:只动托管行,注释/未知段逐字保留
 * (契约测试用真实快照守护);只写变过的键 —— 恒等写回 = 原文件。
 * 思考强度写角色值 `:后缀`(优先于顶层键,顶层 defaultThinkingLevel 独立可编辑)。
 *
 * 模型候选 = models.yml 实况(用户配过/登录过的供应商才会进该文件),
 * 思考档候选优先取各模型 thinkingLevelMap 的键,退回通用强度表。
 */

import { ipc } from "@kernel/ipc";
import {
  getMap,
  getList,
  getScalar,
  setList,
  setMap,
  setScalar,
} from "@kernel/yamlBlocks";
import { getActiveWorkspace } from "@kernel/workspace";
import { t } from "@kernel/i18n";
import type { CliConfigEntry, CliConfigSource, CliConfigValues } from "@kernel/cliConfigRegistry";
import { fetchOmpModelCatalog } from "./configCatalog";
import { OMP_FIELD_DETAILS } from "./configDetails";

/** 已知角色(实施校准点:以 `omp config get modelRoles` 为准;自定义角色可手输)。 */
const OMP_ROLES = [
  "default",
  "smol",
  "slow",
  "plan",
  "advisor",
  "commit",
  "reasoning",
  "title",
  "memory",
];
const OMP_THINKING = ["auto", "off", "minimal", "low", "medium", "high", "max"];
/* 网络搜索 provider 候选:按鉴权方式分组标注(事实 = omp-cli-course 第 7 课 23 provider 清单);
   排序:免 key → OAuth 登录 → 需 API key。 */
const OMP_WEB_PROVIDERS = [
  { value: "duckduckgo", hint: t("免 key") },
  { value: "startpage", hint: t("免 key") },
  { value: "google", hint: t("免 key") },
  { value: "ecosia", hint: t("免 key") },
  { value: "mojeek", hint: t("免 key") },
  { value: "gemini", hint: t("OAuth 登录") },
  { value: "anthropic", hint: t("OAuth 登录") },
  { value: "codex", hint: t("OAuth 登录") },
  { value: "xai", hint: t("OAuth 登录") },
  { value: "kimi", hint: t("OAuth 登录") },
  { value: "perplexity", hint: t("需 API key") },
  { value: "exa", hint: t("需 API key") },
  { value: "zai", hint: t("需 API key") },
  { value: "tavily", hint: t("需 API key") },
  { value: "brave", hint: t("需 API key") },
  { value: "jina", hint: t("需 API key") },
  { value: "kagi", hint: t("需 API key") },
];
const OMP_MEMORY_BACKENDS = ["off", "local", "mnemopi"];

/** 模型目录 = omp models 登录实况 + models.yml 已配置并集(装配与缓存见 configCatalog)。 */

async function ompAgentDir(): Promise<string> {
  return `${await ipc.configHomeDir()}/.omp/agent`;
}

async function fileExists(path: string): Promise<boolean> {
  return await ipc.fsReadFile(path).then(() => true).catch(() => false);
}

/** 配置源:全局 + 活跃工作区项目级 overlay;顺带刷新模型候选目录。 */
export async function ompConfigSources(): Promise<CliConfigSource[]> {
  const dir = await ompAgentDir();
  const globalPath = `${dir}/config.yml`;
  const list: CliConfigSource[] = [
    { id: "global", label: t("全局配置"), path: globalPath, exists: await fileExists(globalPath) },
  ];
  const ws = getActiveWorkspace();
  if (ws) {
    const projectPath = `${ws.root}/.omp/config.yml`;
    list.push({
      id: "project",
      label: t("项目级({name})", { name: ws.name }),
      path: projectPath,
      exists: await fileExists(projectPath),
      note: t(
        "项目级 overlay 叠在全局之上;数组段(modelRoles / fallbackChains / providerChain)整体替换而非追加。首次保存时创建本文件。",
      ),
    });
  }
  return list;
}

export function loadOmpConfig(raw: string): CliConfigValues {
  const L = raw.split("\n");
  return {
    roles: getMap(L, ["modelRoles"]),
    modelFallback: getScalar(L, ["retry", "modelFallback"]) !== "false",
    chains: getMap(L, ["retry", "fallbackChains"]).map(([r]) => {
      const items = getList(L, ["retry", "fallbackChains", r]);
      return [r, items.join(",")] as [string, string];
    }),
    defaultThinkingLevel: getScalar(L, ["defaultThinkingLevel"]) || "auto",
    symbolPreset: getScalar(L, ["symbolPreset"]) || "unicode",
    prewalkEnabled: getScalar(L, ["prewalk", "enabled"]) === "true",
    compactionEnabled: getScalar(L, ["compaction", "enabled"]) === "true",
    memoryBackend: getScalar(L, ["memory", "backend"]) || "off",
    checkpointEnabled: getScalar(L, ["checkpoint", "enabled"]) === "true",
    securityEnabled: getScalar(L, ["security", "enabled"]) === "true",
    ttsrEnabled: getScalar(L, ["ttsr", "enabled"]) !== "false",
    ttsrInterrupt: getScalar(L, ["ttsr", "interruptMode"]) || "always",
    webChain: getList(L, ["webSearch", "providerChain"]),
  };
}

export function saveOmpConfig(raw: string, v: CliConfigValues): string {
  const base = loadOmpConfig(raw);
  let L = raw.split("\n");
  /* 只写变过的键:未触碰的缺失键不会被凭空插入(恒等写回 = 原文件);
     空键行(表单半成品)不落盘 —— 否则产出 `  : ""` 非法 YAML(P0 回归线)。 */
  const changed = (k: string) => JSON.stringify(v[k]) !== JSON.stringify(base[k]);
  if (changed("roles"))
    L = setMap(L, ["modelRoles"], (v.roles as Array<[string, string]>).filter(([k]) => k));
  if (changed("modelFallback")) L = setScalar(L, ["retry", "modelFallback"], v.modelFallback === true);
  if (changed("chains")) {
    const chains = (v.chains as Array<[string, string]>).filter(([r]) => r);
    L = setMap(L, ["retry", "fallbackChains"], chains.map(([r]) => [r, ""] as [string, string]));
    for (const [role, chain] of chains) {
      L = setList(
        L,
        ["retry", "fallbackChains", role],
        chain.split(",").map((s) => s.trim()).filter((s) => s),
      );
    }
  }
  if (changed("defaultThinkingLevel") && v.defaultThinkingLevel)
    L = setScalar(L, ["defaultThinkingLevel"], String(v.defaultThinkingLevel));
  if (changed("symbolPreset")) L = setScalar(L, ["symbolPreset"], String(v.symbolPreset));
  if (changed("prewalkEnabled")) L = setScalar(L, ["prewalk", "enabled"], v.prewalkEnabled === true);
  if (changed("compactionEnabled"))
    L = setScalar(L, ["compaction", "enabled"], v.compactionEnabled === true);
  if (changed("memoryBackend")) L = setScalar(L, ["memory", "backend"], String(v.memoryBackend));
  if (changed("checkpointEnabled"))
    L = setScalar(L, ["checkpoint", "enabled"], v.checkpointEnabled === true);
  if (changed("securityEnabled"))
    L = setScalar(L, ["security", "enabled"], v.securityEnabled === true);
  if (changed("ttsrEnabled")) L = setScalar(L, ["ttsr", "enabled"], v.ttsrEnabled === true);
  if (changed("ttsrInterrupt") && v.ttsrInterrupt)
    L = setScalar(L, ["ttsr", "interruptMode"], String(v.ttsrInterrupt));
  if (changed("webChain"))
    L = setList(L, ["webSearch", "providerChain"], (v.webChain as string[]).filter((s) => s));
  return L.join("\n");
}

export const ompConfigEntry: Omit<CliConfigEntry, "icon"> = {
  id: "omp",
  title: "OMP",
  order: 0,
  sources: ompConfigSources,
  load: loadOmpConfig,
  save: saveOmpConfig,
  rawEditor: "yaml",
  fields: buildFields(),
};

/** schema + 新手说明装配(说明文案在 configDetails.ts)。 */
function buildFields(): CliConfigEntry["fields"] {
  return withDetails([
    {
      id: "roles",
      label: t("模型角色路由"),
      kind: "modelMap",
      keyOptions: OMP_ROLES,
      suffixOptions: OMP_THINKING,
      catalog: fetchOmpModelCatalog,
    },
    {
      id: "modelFallback",
      label: t("撞墙自动回退"),
      kind: "toggle",
    },
    {
      id: "chains",
      label: t("回退链"),
      kind: "modelMap",
      keyOptions: OMP_ROLES,
      suffixOptions: OMP_THINKING,
      catalog: fetchOmpModelCatalog,
      multi: true,
    },
    {
      id: "defaultThinkingLevel",
      label: t("全局思考强度"),
      kind: "select",
      options: OMP_THINKING,
    },
    {
      id: "symbolPreset",
      label: t("符号风格"),
      kind: "select",
      options: ["unicode", "ascii"],
    },
    {
      id: "prewalkEnabled",
      label: t("prewalk"),
      kind: "toggle",
    },
    {
      id: "compactionEnabled",
      label: t("自动压缩历史"),
      kind: "toggle",
    },
    {
      id: "memoryBackend",
      label: t("记忆后端"),
      kind: "select",
      options: OMP_MEMORY_BACKENDS,
    },
    {
      id: "webChain",
      label: t("网络搜索链"),
      kind: "orderedList",
      options: OMP_WEB_PROVIDERS,
    },
    {
      id: "checkpointEnabled",
      label: t("检查点"),
      kind: "toggle",
      advanced: true,
    },
    {
      id: "securityEnabled",
      label: t("安全扫描"),
      kind: "toggle",
      advanced: true,
    },
    {
      id: "ttsrEnabled",
      label: t("流式工具摘要(ttsr)"),
      kind: "toggle",
      advanced: true,
    },
    {
      id: "ttsrInterrupt",
      label: t("ttsr 打断模式"),
      kind: "select",
      options: ["always", "manual"],
      advanced: true,
    },
  ]);
}

function withDetails(fields: CliConfigEntry["fields"]): CliConfigEntry["fields"] {
  return fields.map((f) => ({ ...f, detail: OMP_FIELD_DETAILS[f.id] }));
}
