/**
 * omp 默认状态 ── 创建即赋值的数据源。
 *
 * 实证 ~/.omp/agent/config.yml:
 *   modelRoles:
 *     smol: kimi-code/k3:high          ← 角色模型值可带 ":思考强度" 后缀
 *     default: minimax-code-cn/MiniMax-M3
 *   defaultThinkingLevel: auto
 *
 * 只取 modelRoles.default;fallbackChains 等其它段不相关。
 * 行级最小解析(不引入 yaml 依赖):配置面只有这两种键,契约由单测守护。
 */

import { ipc } from "@kernel/ipc";
import type { CliSessionStatus } from "@kernel/cli";

/** 纯解析:config.yml 文本 → 默认模型/思考强度;取不到模型时给思考强度也算有效观测。 */
export function parseOmpConfigStatus(configYml: string): CliSessionStatus | null {
  const globalThinking = configYml.match(/^defaultThinkingLevel:\s*(\S+)\s*$/m)?.[1];
  const rolesBlock = configYml.match(/^modelRoles:\n((?:[ \t]+\S.*(?:\n|$))+)/m);
  const modelRef = rolesBlock?.[1].match(/^[ \t]+default:\s*(\S+)\s*$/m)?.[1];
  if (!modelRef) return globalThinking ? { thinkingLevel: globalThinking } : null;
  /* 角色模型值格式 provider/model[:thinking];provider/model 本身不含冒号,末冒号即思考后缀 */
  const colon = modelRef.lastIndexOf(":");
  const model = colon >= 0 ? modelRef.slice(0, colon) : modelRef;
  const roleThinking = colon >= 0 ? modelRef.slice(colon + 1) : undefined;
  const thinkingLevel = roleThinking ?? globalThinking;
  return thinkingLevel ? { model, thinkingLevel } : { model };
}

/** IO 薄壳:读 ~/.omp/agent/config.yml;读不到 = null(不猜)。 */
export async function readOmpDefaultStatus(): Promise<CliSessionStatus | null> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return null;
  const text = await ipc.fsReadFile(`${home}/.omp/agent/config.yml`).catch(() => null);
  return text ? parseOmpConfigStatus(text) : null;
}
