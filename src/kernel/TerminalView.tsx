/**
 * 幕布终端 —— xterm.js 透传 PTY 字节流（幕布零渲染原则的唯一实现点）。
 *
 * 生命周期：挂载 → 回放内核输出缓冲（切回不黑屏）→ 订阅实时总线。
 * 输入路径：xterm onData 直写 PTY；富 composer 实装后汇入同一条 write 通道。
 * 渲染层：WebGL addon 承载全屏 TUI 高频重绘，不可用/上下文丢失自动回退 DOM 渲染器。
 * 点缀层：Cmd/Ctrl+F 搜索、可点击链接 —— 纯 xterm 插件，不触碰字节流。
 */

import { memo, useEffect, useRef, useState } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import { ipc, openExternalUrl } from "@kernel/ipc";
import { getPlatformKind } from "@kernel/platform";
import { host, ptyLiveTopic } from "@kernel/host";
import {
  registerTerminalHandle,
  unregisterTerminalHandle,
  type TerminalHandle,
} from "@kernel/messageAnchors";
import { subscribeThemeApplied } from "@kernel/theme";

/** 每次翻页向日志读取的历史字节数(512KB)。 */
const HISTORY_PAGE_BYTES = 512 * 1024;

/** 从文档计算样式读终端 token → xterm theme(主题引擎已内联最新值)。 */
function readTerminalTheme(): ITheme {
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string) => styles.getPropertyValue(name).trim() || undefined;
  return {
    background: read("--tmd-terminal-bg"),
    foreground: read("--tmd-terminal-fg"),
    cursor: read("--tmd-terminal-cursor"),
    selectionBackground: read("--tmd-terminal-selection"),
  };
}

/* 导出级 memo:props 仅 { sessionId: string } 原始类型,浅比较稳定;
   会话切换经 key={activeId} 重挂载,不受影响。内部逻辑零改动。 */
function TerminalViewImpl({ sessionId }: { sessionId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [atTop, setAtTop] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  /* 翻页锚点:当前幕布内容起点在全量输出中的绝对字节偏移;
     prefixRef 按"从旧到新"存已翻出的历史页(数组) */
  const loadingHistoryRef = useRef(false);
  const earliestByteRef = useRef(0);
  const prefixRef = useRef<string[]>([]);
  /* loadEarlier 经 ref 暴露给锚点跳转注册表:handle 在 effect 里注册一次,
     经 ref 取最新闭包,避免 loadingHistory 状态闭包过期。 */
  const loadEarlierRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    /* 终端等宽字体按平台区分:mac 用 Menlo 系,Windows 用 Cascadia/Consolas,Linux 用 DejaVu/Liberation。 */
    const fontFamily =
      getPlatformKind() === "windows"
        ? "'Cascadia Mono', Consolas, 'Courier New', monospace"
        : getPlatformKind() === "linux"
          ? "'DejaVu Sans Mono', 'Liberation Mono', monospace"
          : "Menlo, Monaco, 'Courier New', monospace";
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily,
      /* 默认 1000 行太浅;翻页加载历史后单场可达数万行,放大到 5 万 */
      scrollback: 50_000,
      theme: readTerminalTheme(),
    });
    /* 主题切换 → 重刷 xterm 配色(纯视觉重着色,字节流内容不受影响)。 */
    const offTheme = subscribeThemeApplied(() => {
      term.options.theme = readTerminalTheme();
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    /* 链接点击 → 系统浏览器(Tauri webview 内 window.open 不可靠,走 shell 插件)。 */
    term.loadAddon(new WebLinksAddon((_event, uri) => void openExternalUrl(uri)));
    /* Cmd/Ctrl+F 打开搜索框,拦截不写入 PTY。
       代价:Linux/Windows 下占用 shell 的 readline 前进字符键,换取应用级搜索。 */
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === "keydown" && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        setSearchOpen(true);
        return false;
      }
      return true;
    });
    term.open(container);
    fit.fit();

    /* WebGL 渲染器:omp/claude 全屏重绘的性能关键。必须在 open 之后加载;
       无 WebGL 环境(部分 Linux WebKitGTK)或上下文丢失时回退 DOM 渲染,行为与之前一致。 */
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      /* 保持 DOM 渲染器 */
    }

    termRef.current = term;
    searchRef.current = search;

    // 先回放历史输出，再挂实时流——顺序保证字节流连续
    const replay = host.getOutputBuffer(sessionId);
    if (replay) term.write(replay);

    /* 翻页锚点初始化:缓冲起点绝对偏移 = 日志末尾 - 当前缓冲字节数。
       缓冲是字节流的精确后缀(sliceStreamTail 保证边界),故用字节数反推。 */
    void ipc.sessionLogSize(sessionId).then((end) => {
      /* 字节数由 host 随 append 增量维护,直读即可,不再全量编码 */
      const currentBytes = host.getOutputBufferBytes(sessionId);
      earliestByteRef.current = Math.max(0, end - currentBytes);
      setHasMore(earliestByteRef.current > 0);
    });

    /* 滚动到顶才显示"加载更早的输出"入口 */
    setAtTop(term.buffer.active.viewportY === 0);
    const offScroll = term.onScroll((y) => setAtTop(y === 0));

    const offLive = host.events.on<string>(ptyLiveTopic(sessionId), (text) =>
      term.write(text),
    );
    const offInput = term.onData((data) => void ipc.sessionWrite(sessionId, data));
    /* 对话锚点:向内核注册本幕布的跳转/定位能力(composer 锚点栏经此中转)。 */
    const terminalHandle: TerminalHandle = {
      lineText: (row) => term.buffer.active.getLine(row)?.translateToString(true) ?? "",
      bufferLength: () => term.buffer.active.length,
      viewportTop: () => term.buffer.active.viewportY,
      rows: () => term.rows,
      scrollToLine: (row) => term.scrollToLine(row),
      focus: () => termRef.current?.focus(),
      onScroll: (cb) => {
        const d = term.onScroll(cb);
        return () => d.dispose();
      },
      hasMoreHistory: () => earliestByteRef.current > 0,
      loadEarlier: () => loadEarlierRef.current?.() ?? Promise.resolve(),
    };
    registerTerminalHandle(sessionId, terminalHandle);

    const syncSize = () => {
      fit.fit();
      void ipc.sessionResize(sessionId, term.cols, term.rows);
    };
    syncSize();
    const observer = new ResizeObserver(syncSize);
    observer.observe(container);

    return () => {
      offTheme();
      unregisterTerminalHandle(sessionId, terminalHandle);
      offLive();
      offInput.dispose();
      offScroll.dispose();
      observer.disconnect();
      term.dispose();
      termRef.current = null;
      searchRef.current = null;
      prefixRef.current = [];
      setSearchOpen(false);
      setQuery("");
      setHasMore(false);
      setLoadingHistory(false);
    };
  }, [sessionId]);

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
    termRef.current?.focus();
  };

  /** 往前翻一页:从会话日志读更早的原始输出,RIS 重置后连同现有内容整段重写。 */
  const loadEarlier = async () => {
    /* 重入闸必须用同步 ref:loadingHistory state 要等 React 重渲染才翻转,
       而锚点跳转的翻页循环在微任务里续延 —— state 闸会让第 2 页起确定性停摆 */
    if (loadingHistoryRef.current) return;
    const term = termRef.current;
    if (!term) return;
    loadingHistoryRef.current = true;
    setLoadingHistory(true);
    try {
      const page = await ipc.sessionHistoryPage(
        sessionId,
        earliestByteRef.current,
        HISTORY_PAGE_BYTES,
      );
      if (!page.text) {
        setHasMore(false);
        return;
      }
      prefixRef.current.unshift(page.text); // 更早的页排前面
      earliestByteRef.current = page.startOffset;
      setHasMore(page.hasMore);
      /* \x1bc(RIS)整屏重置后与历史一并入队:与实时写共用 xterm 同一写队列,无竞态;
         期间到达的实时字节已含在 getOutputBuffer 快照里,之后的排在本次写之后。
         顺序逐页 write,不做 join 大字符串 —— 跨页 join 是 O(N²) 字符工作量,
         xterm 自带写队列,分次写入语义与一次性大 write 等价。 */
      term.write("\x1bc");
      for (const prefix of prefixRef.current) term.write(prefix);
      /* 末段 write 回调内 resolve:调用方(锚点跳转翻页循环)await 拿到的是
         buffer 已含新历史的时刻 */
      await new Promise<void>((resolve) =>
        term.write(host.getOutputBuffer(sessionId), () => {
          term.scrollToTop();
          resolve();
        }),
      );
    } finally {
      loadingHistoryRef.current = false;
      setLoadingHistory(false);
    }
  };
  loadEarlierRef.current = loadEarlier;

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {atTop && hasMore && (
        <button
          onClick={() => void loadEarlier()}
          disabled={loadingHistory}
          className="absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-md border border-(--tmd-border) bg-(--tmd-bg-popover) px-3 py-1 text-xs text-(--tmd-accent) shadow-lg hover:bg-(--tmd-bg-hover) disabled:opacity-50"
        >
          {loadingHistory ? "加载中…" : "↑ 加载更早的输出"}
        </button>
      )}
      {searchOpen && (
        <div className="absolute right-3 top-2 z-10 flex items-center gap-1 rounded-md border border-(--tmd-border) bg-(--tmd-bg-popover) px-2 py-1 shadow-lg">
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (e.target.value) searchRef.current?.findNext(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (e.shiftKey) {
                  if (query) searchRef.current?.findPrevious(query);
                } else if (query) {
                  searchRef.current?.findNext(query);
                }
              } else if (e.key === "Escape") {
                closeSearch();
              }
            }}
            placeholder="搜索终端输出"
            className="w-44 bg-transparent text-xs text-(--tmd-fg) outline-none placeholder:text-(--tmd-fg-faint)"
          />
          <button
            title="上一个 (Shift+Enter)"
            onClick={() => query && searchRef.current?.findPrevious(query)}
            className="text-(--tmd-fg-muted) hover:text-(--tmd-fg)"
          >
            <ChevronUp size={14} />
          </button>
          <button
            title="下一个 (Enter)"
            onClick={() => query && searchRef.current?.findNext(query)}
            className="text-(--tmd-fg-muted) hover:text-(--tmd-fg)"
          >
            <ChevronDown size={14} />
          </button>
          <button
            title="关闭 (Esc)"
            onClick={closeSearch}
            className="text-(--tmd-fg-muted) hover:text-(--tmd-fg)"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

export const TerminalView = memo(TerminalViewImpl);
