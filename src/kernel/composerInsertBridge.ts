/**
 * Composer 文本插入桥 —— 跨插件向 composer 草稿追加引用文本的宿主通道。
 *
 * composer 的草稿是组件局部 useState(无全局 store),跨插件写入走内核
 * ref 桥(terminalFindBridge 同款):消费方(Composer)每次渲染同步最新
 * 闭包,请求方只管调用,不感知 composer 是否挂载(未挂载时静默丢弃)。
 * 内核准入:桥是通用原语,不含任何插件私有语义。
 */

/** Composer 每次渲染赋值;卸载置 null。 */
export const composerInsertRef: { current: ((text: string) => void) | null } = {
  current: null,
};

/** 向 composer 草稿光标处追加文本并聚焦输入框;composer 未挂载时为 no-op。 */
export function insertIntoComposer(text: string): void {
  composerInsertRef.current?.(text);
}
