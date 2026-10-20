/**
 * 幕布输出装配 · 分块回放原语 —— writeInChunks / LoadProgress / HiddenDeferControl。
 * 流装配 attachTerminalStream(回放 + 实时订阅 + 就绪探测编排:保序攒队/冻结快照
 * fast 路径/磁盘先行 + 清屏观测/隐藏合帧/静默与双兜底/就绪锁)2026-10-20 拆至
 * terminalStream.ts(守 300 行铁则),下方 re-export 保持消费方路径不变。
 */

import type { Terminal } from "@xterm/xterm";

/** 单块字符数:足够小使进度平滑,又不至于回调过频。 */
const REPLAY_CHUNK_CHARS = 128 * 1024;

/** 隐藏期写入控制(由 TerminalView 供活性真相,避免闭包吃陈旧 active)。 */
export interface HiddenDeferControl {
  /** true = 本幕布当前非激活(隐藏),实时字节攒帧缓写。 */
  shouldDefer(): boolean;
  /** 登记激活冲刷入口;卸载期传 null 解绑(TerminalView 持弱引用)。 */
  bindFlush(flush: (() => void) | null): void;
}

/**
 * 加载进度态(null = 撤罩):
 * - replay:分块回放中,pct 0–100;
 * - stream:等待/接收实时输出中,chars = 已流入字符数(相对输出缓冲上限占比绘条)。
 */
export type LoadProgress =
  | { kind: "replay"; pct: number }
  | { kind: "stream"; chars: number }
  | null;

/** 分块回放,每块解析完回调进度(1-based 块计数);xterm 流式解析器天然容忍块边界切在转义序列中间。 */
export function writeInChunks(
  term: Pick<Terminal, "write">,
  text: string,
  onChunk: (done: number, total: number) => void,
): Promise<void> {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += REPLAY_CHUNK_CHARS) {
    chunks.push(text.slice(i, i + REPLAY_CHUNK_CHARS));
  }
  onChunk(0, chunks.length);
  return chunks.reduce<Promise<void>>(
    (prev, chunk, i) =>
      prev.then(
        () =>
          new Promise<void>((resolve) =>
            term.write(chunk, () => {
              onChunk(i + 1, chunks.length);
              resolve();
            }),
          ),
      ),
    Promise.resolve(),
  );
}

/** 流装配 re-export:消费方 import 路径不变(2026-10-20 拆分)。 */
export { attachTerminalStream } from "./terminalStream";
