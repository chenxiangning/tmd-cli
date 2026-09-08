/**
 * 幕布终端 —— xterm.js 透传 PTY 字节流(幕布零渲染原则的唯一实现点)。
 *
 * 生命周期:挂载 → 回放内核输出缓冲(切回不黑屏)→ 订阅实时总线。
 * 输入路径:xterm onData 直写 PTY;富 composer 实装后汇入同一条 write 通道。
 * 渲染层:WebGL addon 承载全屏 TUI 高频重绘,不可用/上下文丢失自动回退 DOM 渲染器。
 * 点缀层:Cmd/Ctrl+F 搜索、可点击链接 —— 纯 xterm 插件,不触碰字节流。
 *
 * 文件规模铁则拆分(300 行):历史翻页器在 terminalHistory.ts,
 * 搜索浮层与 terminal.find 命令桥在 terminalSearch.tsx。
 */

import { memo, useEffect, useRef, useState } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { openExternalUrl } from "@kernel/ipc";
import { getSettingsState, subscribeSettings } from "@kernel/settings";
import { resolveTerminalFontFamily } from "@kernel/terminalFonts";
import { host } from "@kernel/host";
import {
  registerTerminalHandle,
  unregisterTerminalHandle,
  type TerminalHandle,
} from "@kernel/messageAnchors";
import { subscribeThemeApplied } from "@kernel/theme";
import { createReplayInputGate } from "@kernel/terminalInputGate";
import { attachTerminalStream, type LoadProgress } from "@kernel/terminalReplay";
import { isTerminalReport } from "@kernel/terminalReports";
import { TerminalHistoryPager } from "@kernel/terminalHistory";
import { TerminalSearchOverlay, findRequestRef } from "@kernel/terminalSearch";
import { setTerminalFocused } from "@kernel/shortcuts";

/** 从文档计算样式读终端 token → xterm theme(主题引擎已内联最新值)。
 *  ANSI 16 色与 bg/fg/cursor/selection 同源(--tmd-terminal-* 见 themeTokens.ts)。 */
function readTerminalTheme(): ITheme {
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string) => styles.getPropertyValue(name).trim() || undefined;
  const ansi = {
    black: read("--tmd-terminal-black"), red: read("--tmd-terminal-red"),
    green: read("--tmd-terminal-green"), yellow: read("--tmd-terminal-yellow"),
    blue: read("--tmd-terminal-blue"), magenta: read("--tmd-terminal-magenta"),
    cyan: read("--tmd-terminal-cyan"), white: read("--tmd-terminal-white"),
    brightBlack: read("--tmd-terminal-bright-black"), brightRed: read("--tmd-terminal-bright-red"),
    brightGreen: read("--tmd-terminal-bright-green"),
    brightYellow: read("--tmd-terminal-bright-yellow"),
    brightBlue: read("--tmd-terminal-bright-blue"),
    brightMagenta: read("--tmd-terminal-bright-magenta"),
    brightCyan: read("--tmd-terminal-bright-cyan"),
    brightWhite: read("--tmd-terminal-bright-white"),
  } as const;
  return {
    background: read("--tmd-terminal-bg"),
    foreground: read("--tmd-terminal-fg"),
    cursor: read("--tmd-terminal-cursor"),
    selectionBackground: read("--tmd-terminal-selection"),
    ...ansi,
  };
}

/* 导出级 memo:props 全原始类型,浅比较稳定。keep-alive 语义(MainPanel):
   tab 条内会话常驻挂载,非激活 display:none;active 切换不重挂,仅 ref 所有权迁移。 */
function TerminalViewImpl({ sessionId, active }: { sessionId: string; active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [atTop, setAtTop] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  /* 加载进度态:null = 就绪撤罩;replay = 分块回放 %;stream = 流式接收字节(terminalReplay.ts)。 */
  const [loadProgress, setLoadProgress] = useState<LoadProgress>(null);
  /* 历史重写输入闸:回放/翻页重写期间丢弃 xterm 对历史查询的自动应答
     (见 terminalInputGate.ts);实例随会话 keep-alive 常驻,闸随实例持有。 */
  const inputGateRef = useRef(createReplayInputGate());
  /* 翻页器(实现见 terminalHistory.ts):锚点/前缀页/重入闸随实例持有,
     hasMore/loading 经 onState 回喂上面的 React state。 */
  const pagerRef = useRef<TerminalHistoryPager | null>(null);
  /* loadEarlier 经 ref 暴露给锚点跳转注册表:handle 在 effect 里注册一次,
     经 ref 取最新闭包,避免 loadingHistory 状态闭包过期。 */
  const loadEarlierRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    /* 字号/字体吃 settings(外观页即时改);平台默认栈解析见 kernel/terminalFonts.ts。 */
    const fontSettings = getSettingsState().settings;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: fontSettings.terminalFontSize,
      fontFamily: resolveTerminalFontFamily(fontSettings.terminalFontFamily),
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
    /* 外观页改字号/字体 → 活幕布即时重排(fit 后同步 PTY 尺寸,同窗口 resize 语义)。 */
    const offFontSettings = subscribeSettings(() => {
      const s = getSettingsState().settings;
      term.options.fontSize = s.terminalFontSize;
      term.options.fontFamily = resolveTerminalFontFamily(s.terminalFontFamily);
      fit.fit();
      host.resizeSession(sessionId, term.cols, term.rows);
    });
    term.loadAddon(fit);
    term.loadAddon(search);
    /* 链接点击 → 系统浏览器(Tauri webview 内 window.open 不可靠,走 shell 插件)。 */
    term.loadAddon(new WebLinksAddon((_event, uri) => void openExternalUrl(uri)));
    /* 聚焦态馈入分发器:聚焦期 terminal 作用域优先、global ⌘ 系键照常触发
       (命中即拦截零 PTY 字节,未命中键原样进 PTY)——分发决策见 shortcuts.ts
       resolveCommand。xterm v6 无 onFocus/onBlur 事件,借容器 focusin/focusout(冒泡可达)。 */
    const onFocusIn = () => setTerminalFocused(true);
    const onFocusOut = () => setTerminalFocused(false);
    container.addEventListener("focusin", onFocusIn);
    container.addEventListener("focusout", onFocusOut);
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

    /* 翻页器随挂载创建(会话切换经 key 重挂载,锚点随实例重生)。 */
    const pager = new TerminalHistoryPager(sessionId, inputGateRef.current, (h, l) => {
      setHasMore(h);
      setLoadingHistory(l);
    });
    pagerRef.current = pager;
    /* 翻页器随挂载创建(keep-alive 后每会话仅挂载一次,锚点随实例常驻)。 */

    /* 输出装配(回放分块 + 实时保序 + 进度回调)见 kernel/terminalReplay.ts;
       输入闸语义不变:回放窗口内丢弃历史查询应答(DSR/DA/OSC 颜色会被 xterm
       重新应答,照走 writeSession 即①陈旧应答注入活 PTY ②视同用户首写锚定对话),
       回放尽后释放。 */
    const inputGate = inputGateRef.current;
    const offStream = attachTerminalStream(term, sessionId, inputGate, setLoadProgress);

    /* 翻页锚点初始化(缓冲起点绝对偏移反推,实现见 terminalHistory.ts)。 */
    void pager.init();

    /* 滚动到顶才显示"加载更早的输出"入口 */
    setAtTop(term.buffer.active.viewportY === 0);
    const offScroll = term.onScroll((y) => setAtTop(y === 0));
    /* Ask 屏幕态采样(askWatch v3):omp 等待期间 spinner 以光标寻址持续重绘,
       面板标记一旦流出字节尾窗永不复现(实测 3h 挂起面板后流 7.4MB)——
       字节流检测对此原理性无解,但屏幕上标记始终在:读底部 8 行文本喂检测器
       (命中判定在 askWatch 内,含 CLI 声明标记)。读 baseY 起的活动屏幕
       (非 viewport),用户上翻历史不影响判定。 */
    const askProbe = setInterval(() => {
      const buf = term.buffer.active;
      const bottom = Math.min(buf.length, buf.baseY + term.rows);
      let screenTail = "";
      for (let row = Math.max(0, bottom - 8); row < bottom; row++) {
        screenTail += (buf.getLine(row)?.translateToString(true) ?? "") + "\n";
      }
      host.observeAskScreen(sessionId, screenTail);
    }, 1000);
    /* 闸外照常写会话;终端协议回传(焦点/鼠标/查询应答,见 terminalReports.ts)
       照写 PTY 但标 synthetic —— 它们不是用户输入,不得锚定对话,
       否则点一下终端/滚一轮就会点亮无对话会话的呼吸灯 */
    const offInput = term.onData((data) => {
      if (inputGate.blocked()) return;
      host.writeSession(sessionId, data, isTerminalReport(data));
    });
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
      hasMoreHistory: () => pager.hasMoreHistory(),
      loadEarlier: () => loadEarlierRef.current?.() ?? Promise.resolve(),
    };
    registerTerminalHandle(sessionId, terminalHandle);

    /* 重挂载必发一次;同尺寸 resize 在 Rust 侧幂等去重(pty.rs)。
       经 host.resizeSession 走:真实尺寸变化(SIGWINCH 重绘)由活动守望
       重绘抑制窗吸收,不再误判成一轮对话(见 activityWatch 头注释)。 */
    const syncSize = () => {
      fit.fit();
      host.resizeSession(sessionId, term.cols, term.rows);
    };
    syncSize();
    const observer = new ResizeObserver(syncSize);
    observer.observe(container);

    return () => {
      clearInterval(askProbe);
      offTheme();
      offFontSettings();
      container.removeEventListener("focusin", onFocusIn);
      container.removeEventListener("focusout", onFocusOut);
      unregisterTerminalHandle(sessionId, terminalHandle);
      offStream();
      offInput.dispose();
      offScroll.dispose();
      observer.disconnect();
      term.dispose();
      termRef.current = null;
      searchRef.current = null;
      pagerRef.current = null;
      setSearchOpen(false);
      setHasMore(false);
      setLoadingHistory(false);
    };
  }, [sessionId]);

  /* ⌘F 搜索框所有权:keep-alive 后多幕布并存,模块级 findRequestRef 单槽,
     必须跟随激活实例 —— 激活即持有,失活/卸载仅在仍归自己时让出。 */
  useEffect(() => {
    if (!active) return;
    const mine = () => setSearchOpen(true);
    findRequestRef.current = mine;
    return () => {
      if (findRequestRef.current === mine) findRequestRef.current = null;
    };
  }, [active]);
  const closeSearch = () => {
    setSearchOpen(false);
    termRef.current?.focus();
  };

  /** 往前翻一页(整段重写语义见 terminalHistory.ts)。 */
  const loadEarlier = async () => {
    const term = termRef.current;
    const pager = pagerRef.current;
    if (!term || !pager) return;
    await pager.loadEarlier(term);
  };
  loadEarlierRef.current = loadEarlier;
  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {loadProgress !== null && (
        /* 加载遮罩:回放期显真实解析进度,流式期显真实接收量;输出静默即撤(terminalReplay.ts)。 */
        <div
          className="absolute inset-0 z-10 flex items-center justify-center"
          style={{ background: "var(--tmd-terminal-bg)" }}
        >
          <div className="flex w-56 flex-col items-center gap-2">
            <span className="text-xs text-(--tmd-fg-muted)">
              {loadProgress.kind === "replay"
                ? `加载会话输出… ${loadProgress.pct}%`
                : `加载会话输出… 已接收 ${Math.max(1, Math.round(loadProgress.chars / 1024))}K`}
            </span>
            <div className="h-1 w-full overflow-hidden rounded-full bg-(--tmd-border)">
              <div
                className="h-full bg-(--tmd-accent) transition-[width] duration-150"
                style={{
                  width:
                    loadProgress.kind === "replay"
                      ? `${loadProgress.pct}%`
                      : `${Math.min(99, Math.round(loadProgress.chars / 5000))}%`,
                }}
              />
            </div>
          </div>
        </div>
      )}
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
        <TerminalSearchOverlay searchRef={searchRef} onClose={closeSearch} />
      )}
    </div>
  );
}

export const TerminalView = memo(TerminalViewImpl);
