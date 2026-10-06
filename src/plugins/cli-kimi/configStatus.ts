/**
 * kimi 全局配置态读取(config.toml → 模型/思考强度)—— 2026-10-06 自
 * index.tsx 下放(纯模块;移动端会话状态条直用,mobile/statusProbe.ts
 * 消费先例,同族 cli-grok/configStatus.ts)。
 * kimi 的模型真相只在全局 config.toml(实证 0.40:/model 写配置并热重载,
 * wire.jsonl 无模型事件)→ 会话态与默认态同源,无会话也可读。
 */

import { ipc } from "@kernel/ipc";
import type { CliSessionStatus } from "@kernel/cli";

/**
 * config.toml → 默认模型/思考强度(纯函数,可测)。
 * 行级最小解析(不引入 toml 依赖):配置面只消费这几个键,契约由单测守护。
 * 思考键双代并存:0.40 后期起为 [thinking] 段(enabled 布尔 + effort 档位,
 * 实证本机 config.toml),更早为 default_thinking 布尔 → 映射 "on"/"off"。
 * [thinking] 段优先于旧键;全缺 → thinkingLevel undefined,工具栏显示 "—"。
 */
export function parseKimiConfigStatus(configToml: string): CliSessionStatus | null {
  const model = configToml.match(/^default_model\s*=\s*"([^"]+)"/m)?.[1];
  const legacy = configToml.match(/^default_thinking\s*=\s*(true|false)/m)?.[1];
  const section = configToml.match(/^\[thinking\]\s*\n((?:[^\[].*\n?|\n.*)*?)(?=^\[|\s*$)/m)?.[1];
  const enabled = section?.match(/^enabled\s*=\s*(true|false)\s*$/m)?.[1];
  const effort = section?.match(/^effort\s*=\s*"([^"]+)"/m)?.[1];
  let thinkingLevel: string | undefined;
  if (enabled === "false") {
    thinkingLevel = "off";
  } else if (effort) {
    thinkingLevel = effort;
  } else if (legacy !== undefined) {
    thinkingLevel = legacy === "true" ? "on" : "off";
  }
  if (!model && thinkingLevel === undefined) return null;
  return { model, thinkingLevel };
}

/**
 * 读取模型/思考强度。kimi 的模型真相只在全局 config.toml(实证 0.40:
 * /model 写配置并热重载,wire.jsonl 无模型事件)→ 会话态与默认态同源。
 * home 迁移双路径:~/.kimi-code 优先,老 ~/.kimi 兜底(键型一致)。
 */
export async function readKimiConfigStatus(): Promise<CliSessionStatus | null> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return null;
  for (const path of [
    `${home}/.kimi-code/config.toml`,
    `${home}/.kimi/config.toml`,
  ]) {
    const text = await ipc.fsReadFile(path).catch(() => null);
    const status = text ? parseKimiConfigStatus(text) : null;
    if (status) return status;
  }
  return null;
}
