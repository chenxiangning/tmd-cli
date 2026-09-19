/**
 * 编辑器扩展注册表 —— 插件向文件代码视图(CodeMirror)注入扩展的唯一宿主通道。
 *
 * 准入 = 宿主机制:注册面零业务语义,首个消费者是 kernel/cmEditor/FileCodeEditorImpl
 * (extensions 数组第四组,theme/base/lang 之后)。
 *
 * 拆包红线(council 裁决钉死):本模块对 @codemirror/* 只允许 type-only 引用;
 * 插件工厂体内对 @codemirror/* 只允许动态 import(与 loadCmLanguage 同策略)。
 * 违反会把 CM 全家桶拖回主 chunk,击穿「未开代码文件首屏零加载」。
 */

import type { Extension } from "@codemirror/state";
import { createSubscribable } from "./subscribable";

/** 注入上下文:目标文件与明暗态。 */
export interface EditorExtensionContext {
  path: string;
  dark: boolean;
}

/**
 * 异步扩展工厂:返回 null = 该文件不注入;单厂抛错按失败丢弃,不拖垮编辑器。
 * 必须异步 —— 同步形态会诱使插件静态 import CM,破坏静态图拆包。
 */
export type EditorExtensionFactory = (
  ctx: EditorExtensionContext,
) => Promise<readonly Extension[] | null>;

const factories: EditorExtensionFactory[] = [];
const store = createSubscribable<readonly EditorExtensionFactory[]>([]);

/** 注册编辑器扩展工厂(插件 activate 内调用);返回退订(激活失败回滚用)。 */
export function registerEditorExtension(factory: EditorExtensionFactory): () => void {
  if (!factories.includes(factory)) {
    factories.push(factory);
    store.commit([...factories]);
  }
  return () => {
    const i = factories.indexOf(factory);
    if (i < 0) return;
    factories.splice(i, 1);
    store.commit([...factories]);
  };
}

export function editorExtensionFactories(): readonly EditorExtensionFactory[] {
  return factories;
}

/** React 订阅:工厂清单变化(插件激活/拔出)驱动编辑器重跑工厂。 */
export function useEditorExtensionFactories(): readonly EditorExtensionFactory[] {
  return store.useStore();
}

/** 非 React 订阅(测试);返回退订。 */
export function subscribeEditorExtensions(fn: () => void): () => void {
  return store.subscribe(fn);
}
