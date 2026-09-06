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
import { scanJsonlSessions } from "./diskSessions";
import { readJsonlSessionStatus } from "./sessionStatus";
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
}

/** 生成 profile 的四个会话读取能力(listSessions/readSessionStatus/
 *  readSessionFileIdentity/readSessionUserMessages),展开进 CliProfile 即可。 */
export function piFamilySessions(store: PiFamilyStore) {
  const { sessionsDir } = store;
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
  };
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
