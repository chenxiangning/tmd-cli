/**
 * 终端链接提供者注册表 —— 幕布外点缀层(可点击链接)的插件扩展通道。
 *
 * PTY 幕布硬约束:本通道只把行文本区间标记为可点击 + 点击回调,零字节流触碰、
 * 零幕布内二次渲染;与 WebLinksAddon 同机制(registerLinkProvider)可共存。
 *
 * 聚合形态:kernel 把全部已注册 provider 包装成单个 xterm ILinkProvider 挂到
 * 终端实例;provider 清单运行期动态生效(每次 provideLinks 现读注册表)。
 */

import type { Terminal } from "@xterm/xterm";

/** 行内命中段:0 基列区间,含头不含尾。 */
export interface TerminalLinkHit {
  start: number;
  end: number;
}

export interface TerminalLinkProvider {
  /** 稳定 id(诊断用)。 */
  readonly id: string;
  /**
   * 行内命中。必须同步返回且对不匹配行快速返回空数组 —— provideLinks 逐行
   * 高频调用,慢实现会拖垮整条幕布的链接识别(含内建 URL 链接)。
   */
  find(lineText: string): TerminalLinkHit[];
  /** 点击打开(hit 即 find 返回的引用)。 */
  open(hit: TerminalLinkHit, lineText: string): void;
}

const providers: TerminalLinkProvider[] = [];

export function terminalLinkProviders(): readonly TerminalLinkProvider[] {
  return providers;
}

/** 注册终端链接提供者(插件 activate 内调用);返回退订(激活失败回滚用)。 */
export function registerTerminalLinkProvider(provider: TerminalLinkProvider): () => void {
  const i = providers.findIndex((p) => p.id === provider.id);
  if (i >= 0) providers[i] = provider;
  else providers.push(provider);
  return () => {
    const j = providers.indexOf(provider);
    if (j >= 0) providers.splice(j, 1);
  };
}

/** 聚合全部 provider 为单个 xterm 链接提供者并挂载;provider 清单动态生效。 */
export function attachTerminalLinks(term: Terminal): void {
  term.registerLinkProvider({
    provideLinks(bufferLineNumber, callback) {
      const line = term.buffer.active.getLine(bufferLineNumber - 1);
      const text = line?.translateToString(true) ?? "";
      if (!text) {
        callback(undefined);
        return;
      }
      const links = [];
      for (const provider of providers) {
        /* kernel 不信任插件实现(review P2):find 抛错跳过该 provider,
           否则 callback 永不调用、整行链接识别卡死 */
        let hits: readonly TerminalLinkHit[] = [];
        try {
          hits = provider.find(text);
        } catch {
          continue;
        }
        for (const hit of hits) {
          if (hit.start < 0 || hit.end <= hit.start || hit.end > text.length) continue;
          links.push({
            range: {
              /* xterm 6:IBufferCellPosition 1 基;end = 末字符后一列(不含) */
              start: { x: hit.start + 1, y: bufferLineNumber },
              end: { x: hit.end + 1, y: bufferLineNumber },
            },
            text: text.slice(hit.start, hit.end),
            activate: () => {
              try {
                provider.open(hit, text);
              } catch {
                /* 单 provider open 抛错不拖垮点击 */
              }
            },
          });
        }
      }
      callback(links.length ? links : undefined);
    },
  });
}
