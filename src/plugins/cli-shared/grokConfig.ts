/**
 * grok config.toml 解析 ── 纯函数层(cli-grok 插件与 welcome 凭据盘点共用,
 * 同 codexLocal 先例:CLI 私有知识放 cli-shared,避免插件互相 import)。
 *
 * 实证 ~/.grok/config.toml(grok 1.0.4):
 *   [models]
 *   default = "grok"            ← 档案 id;缺省 = 二进制内置默认 "grok"(grok models 实证)
 *   [model."grok"]
 *   model = "grok-4.6"          ← 真实 wire 模型 id(会话 summary.current_model_id 同源)
 *   base_url = "…" / api_key = "sk-…" ← 自定义供应商端点(quota 凭据来源)
 *
 * 行级最小解析(不引入 TOML 依赖):配置面只有这几种键,契约由单测守护。
 */

/** [model."<id>"] 档案块 —— 状态栏与 quota 凭据的共同数据源。 */
export interface GrokModelProfile {
  /** 档案 id([models].default,内置兜底 "grok")。 */
  id: string;
  /** 真实 wire 模型;档案块缺失/未写时 = id 本身。 */
  model: string;
  /** 自定义供应商端点;缺省 = 官方端点。 */
  baseUrl?: string;
  /** 供应商 API key;缺省 = 官方 OAuth 登录态。 */
  apiKey?: string;
  /** 推理强度(--reasoning-effort);配置未写 = undefined。 */
  reasoningEffort?: string;
}

/** 提取顶层 [section] 块的行(到下一个 `[` 开头行止);无此段返回 null。 */
function tomlBlockLines(text: string, header: string): string[] | null {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === header);
  if (start < 0) return null;
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith("[")) break;
    body.push(lines[i]);
  }
  return body;
}

/** 块内 key = "value" 提取(双引号 TOML basic string;缺键返回 undefined)。 */
function blockString(block: string[], key: string): string | undefined {
  const re = new RegExp(`^[ \\t]*${key}[ \\t]*=[ \\t]*"([^"]*)"`, "m");
  return block.join("\n").match(re)?.[1];
}

/**
 * 解析默认档案(纯函数,可测)。
 * 档案 id 取 [models].default,缺失回退二进制内置 "grok";[model."<id>"] 块缺失
 * = 未自定义档案,model 即 id 本身(grok models 实证内置模型 id 可直接用)。
 */
export function resolveGrokDefaultProfile(configToml: string): GrokModelProfile {
  const id =
    blockString(tomlBlockLines(configToml, "[models]") ?? [], "default") ?? "grok";
  /* TOML 裸键与引号键等价(grok ≡ "grok"),两手写档案头都收;
     含 "." 的 id(如 "grok-4.6")不存在裸键形态,只试引号键防误配嵌套表。 */
  const block =
    tomlBlockLines(configToml, `[model."${id}"]`) ??
    (/^[A-Za-z0-9_-]+$/.test(id)
      ? tomlBlockLines(configToml, `[model.${id}]`)
      : null) ??
    [];
  return {
    id,
    model: blockString(block, "model") ?? id,
    baseUrl: blockString(block, "base_url"),
    apiKey: blockString(block, "api_key"),
    reasoningEffort: blockString(block, "reasoning_effort"),
  };
}
