/**
 * pi 族会话适配器工厂 —— omp / pi 共用(同宗 pi-tui 会话存储,准入 ≥2 消费)。
 *
 * 两家 CLI 共享的格式知识:
 * - 会话 = 每会话一个 JSONL,目录由各家 edits.ts 给出(slug 规则两家分叉,不共享);
 * - 头部身份行 {"type":"session","id","cwd","timestamp"}(sessionIdentity 解析);
 * - 用户消息行解析 ompPiUserMessageLine(userMessages);
 * - 状态读取 readJsonlSessionStatus(模型/供应商字段键各家声明);
 * - 写入事件 = 定位 JSONL → 尾窗读(readEditsTail)→ 解析(结果正文两家分叉,
 *   parse 由各家传入,不共享)。
 */

import { ipc } from "@kernel/ipc";
import type {
  CliDiskSession,
  CliSessionEdit,
  CliSessionStatus,
  CliUserMessage,
  SessionFileIdentity,
} from "@kernel/cli";
import type { RemoteExec } from "@kernel/cli";
import { extractJsonlTitle, scanJsonlSessions } from "./diskSessions";
import { parseJsonlStatusTail, readJsonlSessionStatus } from "./sessionStatus";
import { parsePiFamilySessionHead } from "./sessionIdentity";
import {
  findJsonlSessionFile,
  ompPiUserMessageLine,
  readUserMessagesFromFile,
} from "./userMessages";
import { readEditsTail } from "./sessionEdits";

/** 一家 pi 族 CLI 的会话存储声明。 */
export interface PiFamilyStore {
  /** 本 cwd 的会话目录;找不到家目录/未安装 = null。 */
  sessionsDir: (cwd: string) => Promise<string | null>;
  /** 状态读取的模型字段键(按序探测);缺省 ["model"]。 */
  modelKeys?: readonly string[];
  /** 状态读取的供应商字段键(按序探测);缺省不探测。 */
  providerKeys?: readonly string[];
  /** 远程形态(WSL 发行版内)的会话目录:返回一段 shell 片段,执行后必须把
   *  会话目录放进变量 d(路径规则是引擎知识;远程 $HOME 由 shell 自取)。
   *  缺省 = 该 CLI 不提供远程形态(来源工作区无历史/状态回填)。 */
  remoteSessionsDirSh?: (cwd: string) => string;
}

/** 生成 profile 的会话读取能力(listSessions/readSessionStatus/
 *  readSessionFileIdentity/readSessionUserMessages + 声明 remoteSessionsDirSh 时
 *  附带 remoteSessions 远程内省),展开进 CliProfile 即可。 */
export function piFamilySessions(store: PiFamilyStore) {
  const { sessionsDir } = store;
  const remote = piFamilyRemoteSessions(store);
  return {
    async listSessions(cwd: string): Promise<CliDiskSession[]> {
      const dir = await sessionsDir(cwd);
      if (!dir) return [];
      return scanJsonlSessions(dir);
    },
    async readSessionStatus(
      cwd: string,
      cliSessionId: string,
    ): Promise<CliSessionStatus | null> {
      const dir = await sessionsDir(cwd);
      if (!dir) return null;
      return readJsonlSessionStatus(
        dir,
        cliSessionId,
        store.modelKeys ?? ["model"],
        store.providerKeys,
      );
    },
    /** 身份自证:头部 {"type":"session","id","cwd","timestamp"} 行。 */
    async readSessionFileIdentity(path: string): Promise<SessionFileIdentity | null> {
      const head = await ipc.fsReadHead(path, 4 * 1024).catch(() => null);
      return head ? parsePiFamilySessionHead(head) : null;
    },
    async readSessionUserMessages(
      cwd: string,
      cliSessionId: string,
      full: boolean,
    ): Promise<CliUserMessage[] | null> {
      const dir = await sessionsDir(cwd);
      if (!dir) return null;
      const path = await findJsonlSessionFile(dir, cliSessionId);
      if (!path) return null;
      return readUserMessagesFromFile(path, full, ompPiUserMessageLine);
    },
    /* 远程形态(WSL 发行版内)历史扫描与状态回填;未声明 dirSh 时值为 undefined,
       展开进 profile 与 CliProfile 的可缺省语义对齐。 */
    ...(remote ? { remoteSessions: remote } : {}),
  };
}

/* base64 → utf8(浏览器环境无 Buffer,atob + TextDecoder)。 */
function b64ToUtf8(b64: string): string {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * 远程形态(pi 族布局 + 各家 slug 规则):一次 exec 列目录头(标题/身份/修改时刻),
 * readStatus 尾窗走同一解析。协议:空串 = 无数据(grep 无匹配/目录为空)。
 * 目录头抓 32KB(与本地扫描浅窗同口径),按 mtime 倒序截前 50 条限传输。
 */
export function piFamilyRemoteSessions(store: PiFamilyStore) {
  const dirSh = store.remoteSessionsDirSh;
  if (!dirSh) return undefined;
  const modelKeys = store.modelKeys ?? ["model"];
  const providerKeys = store.providerKeys ?? [];
  const list = async (exec: RemoteExec, cwd: string): Promise<CliDiskSession[]> => {
    const script = `${dirSh(cwd)}
for f in "$d"/*.jsonl; do
  [ -e "$f" ] || continue
  printf '%s\t%s\t' "$(basename "$f" .jsonl)" "$(stat -c %Y "$f")"
  head -c 32768 "$f" | base64 -w0
  printf '\n'
done`;
    const text = await exec(script).catch(() => "");
    const out: CliDiskSession[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const [name, mtime, b64] = line.split("\t");
      const m = /_([0-9a-f-]{36})$/.exec(name ?? "");
      if (!m || !mtime) continue;
      const head = b64 ? b64ToUtf8(b64) : "";
      const identity = parsePiFamilySessionHead(head);
      out.push({
        id: m[1],
        modifiedAt: Number(mtime) * 1000,
        path: `remote:${name}.jsonl`,
        title: extractJsonlTitle(head),
        createdAt: identity?.createdAt,
      });
    }
    return out.sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, 50);
  };
  const readStatus = async (
    exec: RemoteExec,
    cwd: string,
    cliSessionId: string,
  ): Promise<CliSessionStatus | null> => {
    const script = `${dirSh(cwd)}
f=$(ls "$d" 2>/dev/null | grep -F "$(printf '%s' '${cliSessionId}')" | head -n1)
[ -n "$f" ] && tail -c 262144 "$d/$f" | base64 -w0`;
    const text = await exec(script).catch(() => "");
    if (!text.trim()) return null;
    return parseJsonlStatusTail(b64ToUtf8(text.trim()), modelKeys, providerKeys);
  };
  return { list, readStatus };
}

/** readSessionEdits 实现:定位本会话 JSONL → 尾窗读 → 各家 parse 解析增量事件。
 *  文件尚不存在(懒 flush:首条消息才建文件)返回 [],不是失败;
 *  尾窗读取失败返回 null(调用方保水位线重试)。 */
export async function readPiFamilySessionEdits(
  store: Pick<PiFamilyStore, "sessionsDir">,
  parse: (text: string, sinceTs: number, cwd: string) => CliSessionEdit[],
  cwd: string,
  cliSessionId: string,
  sinceTs: number,
): Promise<CliSessionEdit[] | null> {
  const dir = await store.sessionsDir(cwd);
  if (!dir) return null;
  return readEditsTail(
    await findJsonlSessionFile(dir, cliSessionId),
    sinceTs,
    cwd,
    parse,
  );
}
