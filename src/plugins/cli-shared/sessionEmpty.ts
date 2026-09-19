/**
 * jsonl 会话「空判定」共享库 —— 会话卫生清扫(workspace/sessionSweep)的
 * isDiskSessionEmpty 钩子实现基座。
 *
 * cli-shared 准入先例:piFamily(omp/pi)/ cli-claude / cli-codex / cli-qoder /
 * cli-grok / cli-kimi 六方消费同一份磁盘判空知识(≥2 个 cli-* 插件)。
 *
 * 判定口径(保守,沿用 cli-omp/prewarmFs.lockAndRemoveBirthFile 出生文件清理先例):
 * 读头 32KB,**头内连一个用户消息标记子串都没有**才算空。
 *
 * 为什么不做真解析:一旦解析出 0 条就要回答「是真空,还是首条大粘贴把用户消息
 * 推出了 32KB 窗口」—— 无法区分,只能保守判非空。于是「有标记 → 非空」与
 * 「有标记但解析 0 条 → 保守非空」结果相同,解析步骤零判别力,只剩成本。
 * 子串命中即放行不删,误判方向恒为「少删」,不会误删有内容的会话。
 *
 * 本机实证空会话形态(2026-09-19 抽样):omp 206B 只含 type:"custom" 行、
 * claude 1182B 只含 cost-state/mode/permission-mode 行、codex 13-15KB 只含
 * session_meta/event_msg 行 —— 三家头部均无任何用户消息标记子串。
 */

import { ipc } from "@kernel/ipc";

/** 判空读头窗口:与 diskSessions 的标题浅窗同量级(32KB),覆盖出生段全部行型。 */
const EMPTY_CHECK_HEAD_BYTES = 32 * 1024;

/**
 * 用户消息标记子串 —— 与 userMessages.parseUserMessages 的行预筛同源
 * (改一处须同改):
 * - `"role":"user"`:omp/pi(message.message)、claude(user.message)、codex(payload)
 * - `"type":"user"`:claude/qoder/grok 的行型判别字段
 * - `"TurnBegin"` / `"turn.prompt"`:kimi 1.1 老 home / 1.4 kimi-code wire 行型
 * 子串命中即「可能有用户消息」→ 非空(不删),不做精确解析(见文件头)。
 */
const USER_MESSAGE_MARKERS: readonly string[] = [
  '"role":"user"',
  '"type":"user"',
  '"TurnBegin"',
  '"turn.prompt"',
];

/**
 * 判定一个 jsonl 会话文件是否为空(从未有过用户消息)。
 * 读失败 / IPC 异型返回 → false(判不了不删);文件不存在同样走 reject → false。
 */
export async function isJsonlSessionEmpty(path: string): Promise<boolean> {
  let head: unknown;
  try {
    head = await ipc.fsReadHead(path, EMPTY_CHECK_HEAD_BYTES);
  } catch {
    return false;
  }
  /* 契约是 string;桩/封装层一旦返回对象,truthy 对象会在 includes 上炸 —— 与
     readHeadSessionMeta 同款异型防御,异型按「判不了」处理。 */
  if (typeof head !== "string") return false;
  return !USER_MESSAGE_MARKERS.some((marker) => head.includes(marker));
}
