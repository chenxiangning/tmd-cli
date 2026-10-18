/**
 * 索引推进循环(SearchOverlayParts 拆件,组件文件只出组件纪律)——
 * 非组件导出集中到本纯逻辑模块,呈现件留在 SearchOverlayParts.tsx。
 */
import type { SessionIndex, SessionIndexer } from "./indexer";

/** 真读步间隔:单会话读取可达数 MB,不让 I/O 连发卡帧(indexerTicks 要防的)。 */
const STEP_INTERVAL_MS = 60;

/** 每拍时间盒:缓存命中步连做排空(042 裁决②)——否则全部态暖缓存 3500 步
 *  ×60ms≈3.5 分钟不可用;真读步仍维持 STEP_INTERVAL_MS 间隔。 */
export const INDEX_TIME_BOX_MS = 12;

/** tick 推进状态(prime 一拍,之后逐步;导出函数的显式状态参数)。 */
export interface TickState {
  primed: boolean;
}

/** onIndex 快照合流间隔:扫描期每步全语料重扫代价高,≥120ms 才发一次。 */
const INDEX_EMIT_INTERVAL_MS = 120;

/**
 * 一拍推进:prime(首拍)→ 时间盒内连做缓存命中步/真读步;返回下一拍延迟
 * (-1 = 扫完/空索引,停拍)。独立组件外函数——控制流不进 React 函数体
 * (react-doctor 复杂度闸);导出为单测缝(now 注入,不赌 wall clock)。
 */
export async function indexerTick(
  indexer: SessionIndexer,
  state: TickState,
  onIndex: (idx: SessionIndex) => void,
  onSettled: () => void,
  now: () => number,
): Promise<number> {
  if (!state.primed) {
    state.primed = true;
    const total = await indexer.prime().catch(() => 0);
    indexer.index.total = total;
    onIndex({ ...indexer.index }); /* 列举失败位(listFailed)/失效区(goneCwds)随首拍可见 */
    if (total === 0) onSettled();
    return total > 0 ? STEP_INTERVAL_MS : -1;
  }
  const deadline = now() + INDEX_TIME_BOX_MS;
  for (;;) {
    const o = await indexer.step();
    onIndex({ ...indexer.index });
    if (!o.more) {
      onSettled();
      return -1;
    }
    if (!o.cached) return STEP_INTERVAL_MS; /* 真读步:维持 60ms I/O 间隔 */
    if (now() >= deadline) return 0; /* 时间盒到点:缓存步立即续排连做 */
  }
}

/** 索引推进循环:prime 一次后逐步 step,扫完/空索引自停。 */
export function startIndexerTicks(
  indexer: SessionIndexer,
  onIndex: (idx: SessionIndex) => void,
  onSettled: () => void,
  now: () => number = () => performance.now(),
): () => void {
  const state: TickState = { primed: false };
  /* 快照发射合流:距上次发射 ≥120ms 才发(扫描期每步全语料重扫代价高),
   * settle 时无条件补发终态快照,最终计数不丢。状态挂循环闭包,跨拍持续。 */
  let lastEmitAt = -Infinity;
  const emit = () => {
    const t = now();
    if (t - lastEmitAt < INDEX_EMIT_INTERVAL_MS) return;
    lastEmitAt = t;
    onIndex({ ...indexer.index });
  };
  const flush = () => {
    lastEmitAt = now();
    onIndex({ ...indexer.index });
  };
  const settle = () => {
    flush();
    onSettled();
  };
  /* 单步失败只跳过该会话(坏行/越权读),不灭循环 —— 否则一步 reject
   * 永久停摆且 indexing 永不落位,搜索静默变成「永远扫不完」。
   * 自调度 setTimeout 链:上一拍 await 完才排下一拍,单会话读取(数 MB)
   * 超 60ms 时不再多拍并发在途。 */
  let stop = () => {};
  stop = (() => {
    let stopped = false;
    let timer: number | undefined;
    const run = async () => {
      let delay = STEP_INTERVAL_MS;
      try {
        delay = await indexerTick(indexer, state, emit, settle, now);
      } catch {
        delay = STEP_INTERVAL_MS; /* 单步失败跳过,不灭循环 */
      }
      if (delay >= 0 && !stopped) timer = window.setTimeout(() => void run(), delay);
    };
    timer = window.setTimeout(() => void run(), STEP_INTERVAL_MS);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  })();
  return stop;
}
