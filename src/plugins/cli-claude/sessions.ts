/**
 * claude 磁盘会话扫描 + 会话状态读取 —— 扫描自 index.tsx 拆出、状态读取
 * 2026-10-06 自 index.tsx 下放(叶子模块;移动端 home 历史与会话状态条直用,
 * mobile/statusProbe.ts 消费先例)。
 * 布局实证(claude 2.1.251):~/.claude/projects/<slug>/<session-uuid>.jsonl,
 * 目录即 cwd 分区,文件名即会话 id。
 */

import { ipc } from "@kernel/ipc";
import type { CliDiskSession, CliSessionStatus } from "@kernel/cli";
import { readHeadMetasBatch } from "../cli-shared/sessionHead";
import { readStatusTailGated } from "../cli-shared/sessionStatus";

/**
 * claude 磁盘会话存储(实证自 ~/.claude/projects/ 真实目录,claude 2.1.251):
 * - 目录 = ~/.claude/projects/<slug>/<session-uuid>.jsonl(文件名即会话 id)
 * - slug 规则: cwd 中所有非 [a-zA-Z0-9] 字符逐一替换为 "-"
 *   例 /Users/x/code/AI/github/mossx → -Users-x-code-AI-github-mossx
 *   例 /Users/x/.claude → -Users-x--claude (点号同样替换)
 *   例 /Users/x/code/内容分析 → -Users-x-code----- (每个非 ASCII 字符一个 -)
 * - 目录本身即 cwd 分区,无需像 codex rollout 那样读文件头过滤。
 */
export function claudeProjectSlug(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

export async function claudeSessionsDir(cwd: string): Promise<string | null> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return null;
  return `${home}/.claude/projects/${claudeProjectSlug(cwd)}`;
}

export async function listClaudeSessions(cwd: string): Promise<CliDiskSession[]> {
  const dir = await claudeSessionsDir(cwd);
  if (!dir) return [];
  const files = await ipc.fsCollectFiles(dir, ".jsonl").catch(() => []);
  /* 文件名即 sessionId(6b844d1a-…,直接喂 --resume);目录已按 cwd 分区,每个
     文件都值得读。批量读头(sessionHead):外网中继 N+1 读头 = 并发帽快拒 +
     链路拥塞,一次批量 + mtime 缓存把重扫收敛为 1+chunked 次 IPC;结果保持
     files 原序。一次读头双解析:标题 + createdAt(创建时刻定死看板日历落位)。 */
  const matched = files.flatMap((f) => {
    const m = f.name.match(/^([0-9a-f-]{36})\.jsonl$/);
    return m ? [{ id: m[1], path: f.path, modifiedAt: f.modifiedAt }] : [];
  });
  const metas = await readHeadMetasBatch(matched);
  return matched.map((f, i) => ({
    id: f.id,
    modifiedAt: f.modifiedAt,
    createdAt: metas[i].createdAt,
    path: f.path,
    title: metas[i].title,
  }));
}

const STATUS_TAIL_BYTES = 256 * 1024;

/**
 * 从会话文件尾部提取当前模型(纯函数,可测)。
 * claude jsonl 行型实证:assistant 行的 message.model 是真相;倒序找最后一帧。
 * user/queue-operation 行无 model 字段,天然被 type 守卫排除。
 */
export function extractClaudeModel(tail: string): string | undefined {
  for (const line of tail.split("\n").reverse()) {
    if (!line.includes('"model"')) continue;
    try {
      // 外部 JSON 逐层 in/typeof 收窄,不做 inline cast
      const event: unknown = JSON.parse(line);
      if (!event || typeof event !== "object" || !("type" in event)) continue;
      if (event.type !== "assistant" || !("message" in event)) continue;
      const message: unknown = event.message;
      if (!message || typeof message !== "object" || !("model" in message)) continue;
      const model: unknown = message.model;
      if (typeof model === "string" && model) return model;
    } catch {
      // 尾部块的首行可能被截断,跳过继续读完整行。
    }
  }
  return undefined;
}

export async function readClaudeSessionStatus(
  cwd: string,
  cliSessionId: string,
): Promise<CliSessionStatus | null> {
  const dir = await claudeSessionsDir(cwd);
  if (!dir) return null;
  /* claude 思考强度不落盘到会话文件(settings 全局开关),不提供 thinkingLevel。 */
  return readStatusTailGated(
    `${dir}\u0000${cliSessionId}`,
    async () => `${dir}/${cliSessionId}.jsonl`,
    STATUS_TAIL_BYTES,
    (tail) => {
      const model = extractClaudeModel(tail);
      return model ? { model } : null;
    },
  );
}
