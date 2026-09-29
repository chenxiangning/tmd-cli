/**
 * dev 冷启动竞态护栏(2026-09-29 白屏实证):vite 初始依赖优化未完成时,
 * 动态 import 会撞 504 Outdated Optimize Dep 被拒;React lazy 把 rejection
 * 永久缓存,首开文件后中央区永久空白、code 渲染全丢,直到整页刷新。本包装
 * 在单一 promise 链内指数退避重试,等依赖优化完成即成功;成功 memo 与原生
 * import 一致,生产 chunk 无 504 失败面、重试零成本。终败 rejection 不缓存
 * (清 memo),下一个 lazy 包装拿到全新链。
 */

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

export function retryImport<T>(load: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | null = null;
  const attempt = (i: number): Promise<T> =>
    load().catch((err: unknown) => {
      /* 500ms 起指数退避、8s 封顶,14 次总计约 70s —— 覆盖最慢冷优化。 */
      if (i >= 14) throw err;
      return delay(Math.min(500 * 2 ** i, 8_000)).then(() => attempt(i + 1));
    });
  return () => {
    if (!cached) {
      cached = attempt(0).catch((err: unknown) => {
        cached = null;
        throw err;
      });
    }
    return cached;
  };
}
