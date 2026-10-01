/**
 * 索引推进循环(SearchOverlayParts 拆件,组件文件只出组件纪律)——
 * 非组件导出集中到本纯逻辑模块,呈现件留在 SearchOverlayParts.tsx。
 */
import type { SessionIndex, SessionIndexer } from "./indexer";

/** 索引推进节奏:每 60ms 一个会话(单会话读取可达数 MB,不让 I/O 连发)。 */
const STEP_INTERVAL_MS = 60;

/** 索引推进循环:prime 一次后逐步 step,扫完/空索引自停。
 *  独立组件外函数——控制流不进 React 函数体(react-doctor 复杂度闸)。 */
export function startIndexerTicks(
  indexer: SessionIndexer,
  onIndex: (idx: SessionIndex) => void,
  onSettled: () => void,
): () => void {
  let primed = false;
  let stop: () => void;
  const tick = async (): Promise<boolean> => {
    if (!primed) {
      primed = true;
      const total = await indexer.prime().catch(() => 0);
      indexer.index.total = total;
      onIndex({ ...indexer.index }); /* 列举失败位(listFailed)随首拍可见 */
      if (total === 0) {
        onSettled();
        stop();
      }
      return total > 0;
    }
    const more = await indexer.step();
    onIndex({ ...indexer.index });
    if (!more) {
      onSettled();
      stop(); // 扫完自停
    }
    return more;
  };
  /* 单步失败只跳过该会话(坏行/越权读),继续推进 —— 否则一步 reject
   * 永久停摆且 indexing 永不落位,搜索静默变成「永远扫不完」。
   * 自调度 setTimeout 链:上一拍 await 完才排下一拍,单会话读取(数 MB)
   * 超 60ms 时不再多拍并发在途。 */
  stop = (() => {
    let stopped = false;
    let timer: number | undefined;
    const run = async () => {
      let keepGoing = false;
      try {
        keepGoing = await tick();
      } catch {
        keepGoing = true; /* 单步失败跳过,不灭循环 */
      }
      if (keepGoing && !stopped) timer = window.setTimeout(() => void run(), STEP_INTERVAL_MS);
    };
    timer = window.setTimeout(() => void run(), STEP_INTERVAL_MS);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  })();
  return stop;
}
