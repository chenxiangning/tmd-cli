/**
 * Ask 等待状态开机恢复 —— webview 全量重载(HMR 整页 reload / ⌘R)会清空
 * AskWatch 内存态、输出缓冲与 tab 条,而 Rust 侧 PTY 与静态 Ask 面板照常存活:
 * 面板不再产生带标记的新字节,关 tab 的会话没有任何恢复入口(屏幕采样要
 * TerminalView 挂载,回放补观察要内存缓冲非空),表现为「后台会话收不到
 * ask 提示,必须打开才能收到」。本件在 boot 时把每条活 CLI 会话的磁盘日志
 * 尾巴喂回检测器(feed.restoreTail):静态面板的字面量仍在日志尾(仍在等待)
 * → 立候选,守望漂移确认后升级;早已作答/响应流已推出标记的尾巴无字面量,
 * 零副作用。纯 boot 一次性,不订阅不轮询。
 */

import { host } from "./host";
import { ipc, type SessionMeta } from "./ipc";

/** 恢复喂入量:大于 RAW_TAIL_CHARS(1024),与回放补观察同口径。 */
const RESTORE_TAIL_BYTES = 2048;

/** boot 接线(main.tsx 调一次):逐条活 CLI 会话读日志尾喂 askWatch。fire-and-forget,
 *  失败仅告警 —— 恢复是增强,不得阻塞/拖垮启动。 */
export function bootAskRestore(): void {
  void (async () => {
    const sessions = await ipc.sessionList();
    await Promise.all(sessions.map(restoreOne));
  })().catch((e: unknown) => console.warn("ask 等待状态恢复失败:", e));
}

async function restoreOne(meta: SessionMeta): Promise<void> {
  if ((meta.kind ?? "cli") !== "cli") return; /* ssh/shell 无 CLI 面板标记 */
  const end = await ipc.sessionLogSize(meta.id);
  if (!end) return; /* 无日志(含内存态尚未落盘的新会话)= 无可恢复 */
  const page = await ipc.sessionHistoryPage(meta.id, end, RESTORE_TAIL_BYTES);
  if (!page.text) return;
  /* 恢复路径会话可能尚未入 host.sessions 表(boot 竞态),askMarks 查不到,
     按 profileId 显式携带 —— 未注册 profile 的标记集为 undefined,仅剩内核
     通用标记,与实时路径的同名语义一致。 */
  const extraMarks = host.getCliProfile(meta.profileId)?.askMarks;
  host.restoreTail(meta.id, page.text, extraMarks);
}
