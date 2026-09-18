/**
 * codex 会话状态读取(自 index.tsx 拆出,only-export-components 与行数铁则):
 * rollout 尾窗 → 模型/思考强度探测,尺寸闸命中拍免列目录免读头。
 * 磁盘形态实证见 index.tsx 存储注释(不按 cwd 分目录,归属校验靠首行 session_meta)。
 */

import { ipc } from "@kernel/ipc";
import type { CliSessionStatus } from "@kernel/cli";
import { pathsEqual } from "@kernel/pathUtils";
import { getPlatformKind } from "@kernel/platform";
import { readStatusTailGated } from "../cli-shared/sessionStatus";

/* macOS APFS / Windows NTFS 默认大小写不敏感,cwd 严格相等会在大小写/分隔符差异时漏配。 */
const CASE_INSENSITIVE_FS = getPlatformKind() !== "linux";

/** meta 头部读取字节数。 */
export const HEAD_BYTES = 4096;

export function extractMeta(head: string): { id: string; cwd: string; createdAt?: number } | null {
  const firstLine = head.split("\n", 1)[0];
  if (!firstLine.includes('"type":"session_meta"')) return null;
  const id = firstLine.match(/"id":"([0-9a-f-]{36})"/)?.[1];
  const rawCwd = firstLine.match(/"cwd":"((?:[^"\\]|\\.)*)"/)?.[1];
  if (!id || !rawCwd) return null;
  try {
    /* payload.timestamp = 会话创建时刻(实证 2026-09-03,resume 不改写):
       regex 命中即可,同窗零新增 IO;创建时刻定死看板日历落位。 */
    const tsIso = firstLine.match(/"timestamp":"((?:[^"\\]|\\.)*)"/)?.[1];
    let createdAt: number | undefined;
    if (tsIso) {
      const ms = Date.parse(JSON.parse(`"${tsIso}"`) as string);
      if (Number.isFinite(ms)) createdAt = ms;
    }
    return { id, cwd: JSON.parse(`"${rawCwd}"`) as string, createdAt };
  } catch {
    return null;
  }
}

function extractLastJsonString(text: string, keys: readonly string[]) {
  /* 键别名按优先级:第一个有匹配的键获胜,键内取文件位置最后一次。
     此前 result 跨键连续覆盖,最末别名(effort)会压掉更权威的
     reasoning_effort —— 与 model 路径的 `?? 优先级` 语义自相矛盾。 */
  for (const key of keys) {
    const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, "g");
    let found: string | undefined;
    for (const match of text.matchAll(pattern)) {
      found = match[1];
    }
    if (found !== undefined) return found;
  }
  return undefined;
}

export async function readCodexSessionStatus(
  cwd: string,
  cliSessionId: string,
): Promise<CliSessionStatus | null> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return null;
  const dir = `${home}/.codex/sessions`;
  /* head 的归属校验与 model 兜底随闸未命中的定位一并做,命中拍整段免掉(collect+head+tail) */
  let headModel: string | undefined;
  let headModelId: string | undefined;
  return readStatusTailGated(
    `${dir}\u0000${cliSessionId}`,
    async () => {
      /* rollout 不按 cwd 分目录,meta 校验归属防跨工作区误读 */
      const files = await ipc.fsCollectFiles(dir, ".jsonl").catch(() => []);
      const file = files.find((entry) => entry.name.includes(cliSessionId));
      if (!file) return null;
      const head = await ipc.fsReadHead(file.path, HEAD_BYTES).catch(() => "");
      const meta = head ? extractMeta(head) : null;
      if (meta && !pathsEqual(meta.cwd, cwd, CASE_INSENSITIVE_FS)) return null;
      headModel = head ? extractLastJsonString(head, ["model"]) : undefined;
      headModelId = head ? extractLastJsonString(head, ["modelId"]) : undefined;
      return file.path;
    },
    256 * 1024,
    (tail) => {
      const model = extractLastJsonString(tail, ["model"]) ?? headModel ?? headModelId;
      const thinkingLevel = extractLastJsonString(tail, [
        "reasoning_effort",
        "reasoningEffort",
        "effort",
      ]);
      return model || thinkingLevel ? { model, thinkingLevel } : null;
    },
  );
}
