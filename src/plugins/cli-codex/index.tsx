import { ipc } from "@kernel/ipc";
import type { CliDiskSession, CliSessionStatus } from "@kernel/cli";
import type { Plugin } from "@kernel/plugin";

/** codex 用 OpenAI 六边形 glyph(codemoss EngineIcon 同源),currentColor 随主题。 */
function CodexGlyph({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      style={{ width: size, height: size, flexShrink: 0 }}
      aria-hidden
    >
      <path
        d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 0 0-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 0 1 .476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 0 1 4.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 0 1-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 0 0 5.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0 0 10.205 0a5.947 5.947 0 0 0-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 0 0 4.162 1.713z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  );
}

/**
 * codex 磁盘会话存储(实证自 ~/.codex/sessions/ 真实目录):
 * - 目录 = ~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<ts>-<uuid>.jsonl
 * - 不按 cwd 分目录:首行 session_meta.payload 内含 id + cwd,据此过滤。
 * - meta 行含完整 system prompt(可达数十 KB),不做整行 JSON.parse,
 *   只从头部 4KB 正则提取 id/cwd(两字段在 payload 最前,实证 <300 字节)。
 */

/** 扫描上限:rollout 已按 mtime 倒序,只解析最近 N 个文件的头部。 */
const SCAN_LIMIT = 200;
/** 每个工作区展示上限。 */
const RESULT_LIMIT = 200; // 与 SCAN_LIMIT 对齐:展示层分页(10/20/40/80),扫描不必再卡小上限
/** meta 头部读取字节数。 */
const HEAD_BYTES = 4096;

function extractMeta(head: string): { id: string; cwd: string } | null {
  // 只认首行 session_meta,防止误匹配对话内容里的同名字段
  const firstLine = head.split("\n", 1)[0];
  if (!firstLine.includes('"type":"session_meta"')) return null;
  const id = firstLine.match(/"id":"([0-9a-f-]{36})"/)?.[1];
  const rawCwd = firstLine.match(/"cwd":"((?:[^"\\]|\\.)*)"/)?.[1];
  if (!id || !rawCwd) return null;
  try {
    return { id, cwd: JSON.parse(`"${rawCwd}"`) as string };
  } catch {
    return null;
  }
}

async function listCodexSessions(cwd: string): Promise<CliDiskSession[]> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return [];
  const rollouts = await ipc
    .fsCollectFiles(`${home}/.codex/sessions`, ".jsonl")
    .catch(() => []);
  const sessions: CliDiskSession[] = [];
  for (const f of rollouts.slice(0, SCAN_LIMIT)) {
    if (sessions.length >= RESULT_LIMIT) break;
    const head = await ipc.fsReadHead(f.path, HEAD_BYTES).catch(() => "");
    const meta = head ? extractMeta(head) : null;
    if (!meta || meta.cwd !== cwd) continue;
    // codex resume/fork 会在新日期目录写同 id 的新 rollout 文件:
    // 按 id 去重,保留最新 mtime(rollouts 已按 mtime 倒序,先见即最新)
    if (sessions.some((s) => s.id === meta.id)) continue;
    sessions.push({ id: meta.id, modifiedAt: f.modifiedAt, path: f.path });
  }
  return sessions;
}
 
async function readCodexSessionStatus(
  cwd: string,
  cliSessionId: string,
): Promise<CliSessionStatus | null> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return null;
  const rollouts = await ipc
    .fsCollectFiles(`${home}/.codex/sessions`, ".jsonl")
    .catch(() => []);
  const file = rollouts.find((entry) => entry.name.includes(cliSessionId));
  if (!file) return null;

  const head = await ipc.fsReadHead(file.path, HEAD_BYTES).catch(() => "");
  const meta = head ? extractMeta(head) : null;
  if (meta && meta.cwd !== cwd) return null;
  const tail = await ipc.fsReadTail(file.path, 256 * 1024).catch(() => "");
  const model =
    extractLastJsonString(`${head}\n${tail}`, ["model"]) ??
    extractLastJsonString(head, ["modelId"]);
  const thinkingLevel = extractLastJsonString(tail, [
    "reasoning_effort",
    "reasoningEffort",
    "effort",
  ]);
  return model || thinkingLevel ? { model, thinkingLevel } : null;
}

function extractLastJsonString(text: string, keys: readonly string[]) {
  let result: string | undefined;
  for (const key of keys) {
    const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, "g");
    for (const match of text.matchAll(pattern)) {
      result = match[1];
    }
  }
  return result;
}

/**
 * codex CLI 插件（CLI 能力矩阵调研结论）：
 * 三个触发符 `$` `/` `@` 全部原生支持，零翻译纯透传。
 * 会话恢复：codex resume <id>；历史列表 = 扫 codex 自己的 rollout 目录按 cwd 过滤。
 */
export const cliCodexPlugin: Plugin = {
  id: "cli-codex",
  activate(ctx) {
    ctx.registerCliProfile({
      id: "codex",
      name: "codex",
      renderIcon: (size) => <CodexGlyph size={size} />,
      command: "codex",
      args: [],
      triggers: [
        { char: "$", kind: "skill" },
        { char: "/", kind: "command" },
        { char: "@", kind: "file" },
      ],
      resumeArgs: (sessionId) => ["resume", sessionId],
      listSessions: listCodexSessions,
      readSessionStatus: readCodexSessionStatus,
    });
  },
};
