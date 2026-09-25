/** Promise.withResolvers 垫片(Safari 17.4+;壳声明支持 iOS 16.0)。
 * 必须是 main.tsx 首个 import:ESM 静态 import 全部先于 main 模块体求值,
 * 垫片留在 main 体内则任何被静态引入模块的顶层 withResolvers 都会先炸(评审 P2-4)。 */
if (typeof Promise !== "undefined" && !Promise.withResolvers) {
  Promise.withResolvers = function <T>() {
    let resolve!: (v: T | PromiseLike<T>) => void;
    let reject!: (r?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}
