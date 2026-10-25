/**
 * 幕布终端 —— xterm.js 透传 PTY 字节流(幕布零渲染原则的唯一实现点)。
 *
 * 生命周期:挂载 → 回放内核输出缓冲(切回不黑屏)→ 订阅实时总线。
 * 输入路径:xterm onData 直写 PTY;富 composer 实装后汇入同一条 write 通道。
 * 渲染层:xterm 内建 DOM 渲染器(WebGL 方案因 WebKit texSubImage2D 缺陷弃用)。
 * 点缀层:Cmd/Ctrl+F 搜索、可点击链接 —— 纯 xterm 插件,不触碰字节流。
 *
 * 文件规模铁则拆分(300 行):翻页器/搜索/遮罩/刷新钮/健康巡检/滚动位保持分别在
 * terminalHistory / terminalSearch / terminalLoadOverlay / terminalRefreshButton / terminalCanvasHealth / terminalScrollKeeper。
 */

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { ipc, openExternalUrl } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { getSettingsState, subscribeSettings } from "@kernel/settings";
import { resolveTerminalFontFamily } from "@kernel/terminalFonts";
import { host } from "@kernel/host";
import {
  registerTerminalHandle,
  unregisterTerminalHandle,
  type TerminalHandle,
} from "@kernel/messageAnchors";
import { subscribeTerminalTheme } from "@kernel/terminalThemeBridge";
import { createReplayInputGate } from "@kernel/terminalInputGate";
import { attachTerminalStream, settleTerminalJump, type LoadProgress } from "@kernel/terminalReplay";
import { isTerminalReport, shouldSuppressProbeReply } from "@kernel/terminalReports";
import {
  observeCanvasSize,
  settleTerminalFreeze,
  startAskScreenProbe,
  startCanvasStallProbe,
} from "@kernel/terminalCanvasHealth";
import { takeTerminalFreeze } from "@kernel/terminalFreeze";
import { TerminalHistoryPager } from "@kernel/terminalHistory";
import { createScrollKeeper } from "@kernel/terminalScrollKeeper";
import { TerminalSearchOverlay, useSearchBoxOwnership } from "@kernel/terminalSearch";
import { makeLogSearchBridge } from "@kernel/terminalFindBridge";
import { TerminalToolRow } from "@kernel/terminalRefreshButton";
import "@kernel/terminalFontZoom"; /* 终端字号缩放键位(⌘+/⌘−/⌘0):模块级注册,随幕布装配生效 */
import { TerminalCopyMenu } from "@kernel/terminalCopyMenu";
import { TerminalLoadOverlay } from "@kernel/terminalLoadOverlay";
import { attachTerminalLinks } from "@kernel/terminalLinks";
import { setTerminalFocused } from "@kernel/shortcuts";
import { readTerminalTheme } from "@kernel/terminalXtermTheme";

/* 导出级 memo:props 全原始类型,浅比较稳定(keep-alive 语义见 MainPanel)。
   tab 条内会话常驻挂载,非激活 display:none;active 切换不重挂,仅 ref 所有权迁移。 */
function TerminalViewImpl({ sessionId, active }: { sessionId: string; active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [atTop, setAtTop] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  /* 加载进度态:null = 就绪撤罩(terminalReplay.ts);streamReadyRef = 幕布流就绪相位(onReady 置位),askProbe 停采判据(评审 F5/P1-2)。 */
  const [loadProgress, setLoadProgress] = useState<LoadProgress>(null);
  const streamReadyRef = useRef(false);
  const pagerRef = useRef<TerminalHistoryPager | null>(null);
  /* 历史重写输入闸:回放/翻页重写期间丢弃 xterm 对历史查询的自动应答(见 terminalInputGate.ts);
     实例随会话 keep-alive 常驻;惰性初值 = useState 初始化器只在首帧执行一次。 */
  const [inputGate] = useState(createReplayInputGate);
  /* 翻页器(实现见 terminalHistory.ts):锚点/前缀页/重入闸随实例持有,hasMore/loading 经 onState 回喂。 */
  /** 幕布重建代数:刷新钮/停滞探针自增 → 主 effect 重跑 = xterm 销毁重建 +
      缓冲回放 + 强制 SIGWINCH 整帧重绘,PTY/CLI 不中断(会话内自救出口)。 */
  const [canvasGen, setCanvasGen] = useState(0);
  /** 隐藏幕布合帧写入(Fix B,terminalReplay.ts):activeRef 是活性真相;
      激活即冲刷攒帧,切换无感。 */
  const activeRef = useRef(active);
  const flushDeferredRef = useRef<(() => void) | null>(null);
  const lastLiveAtRef = useRef(0); /* 停滞探针活性真相(terminalCanvasHealth 消费) */
  /* 滚动位保持(terminalScrollKeeper.ts):隐藏/重显与重排的滚动语义;实例随会话 keep-alive 常驻。 */
  const [scrollKeeper] = useState(createScrollKeeper);
  useEffect(() => {
    activeRef.current = active;
    if (active) {
      flushDeferredRef.current?.();
      scrollKeeper.restore(termRef.current);
    } else {
      scrollKeeper.markHidden(containerRef.current);
    }
    /* 在视打点随活性同拍:泵侧聚合降档判据(无人观看 → 250ms 慢拍,见
       pty_spawn.rs OUT_BACKGROUND_WINDOW;2026-10-04 十一轮)。 */
    void ipc.sessionSetViewed(sessionId, active).catch(() => undefined);
    return () => void ipc.sessionSetViewed(sessionId, false).catch(() => undefined);
  }, [sessionId, active, scrollKeeper]);
  /** 往前翻一页:实例内恒稳定,锚点注册表与"加载更早"按钮共用同一闭包。 */
  const loadEarlier = useCallback(async () => {
    const term = termRef.current;
    const pager = pagerRef.current;
    if (!term || !pager) return;
    await pager.loadEarlier(term);
  }, []);
  const loadEarlierRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    /* 重建重挂(canvasGen>0)弃挤除快照:重建前幕布可能滞留停滞期旧帧,投影不可信走全量。 */
    if (canvasGen > 0) takeTerminalFreeze(sessionId);

    /* 字号/字体吃 settings(外观页即时改);平台默认栈解析见 kernel/terminalFonts.ts。 */
    const fontSettings = getSettingsState().settings;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: fontSettings.terminalFontSize,
      fontFamily: resolveTerminalFontFamily(fontSettings.terminalFontFamily),
      /* 上限即重排成本上限:尺寸变化时 xterm 同步 rewrap 全缓冲,行数越多主线程
         阻塞越久,超 render_health 探针 4s 静默窗会被误判悬死而 reload(重挂回放
         阅读位归零,2026-10-22 实锤)。2.4 万把最重 rewrap 压回死限内,更早走翻页。 */
      scrollback: 24_000,
      theme: readTerminalTheme(),
    });
    /* 配色重刷:主题引擎与打穿等 :root 终端 token 写手都经主题桥通知,重读计算样式。
       纯视觉重着色,字节流不受影响。 */
    const offTokens = subscribeTerminalTheme(() => {
      term.options.theme = readTerminalTheme();
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    /* 错栅格自愈旗:零宽跳过(隐藏期)或尚未成功 fit 过的实例置位,下次成功 sync
       必须强制 PTY 真实重排 —— 同尺寸 fit 被 xterm 跳过、同尺寸 resize 被 Rust
       幂等去重(无 SIGWINCH),隐藏期任何瞬态错栅格(2 列钳制重排、重挂载回放
       错栅、ConPTY resize 抖动)都将永不重绘:omp 靠 spinner 连续整帧重绘自愈,
       静态 TUI(claude/codex/kimi 跑完一轮即静止)则永久错位。 */
    const needsForceSyncRef = { current: true };
    /** 尺寸同步唯一出口:零宽(隐藏)跳过并挂自愈旗;成功即 fit + 同步 PTY。
        settings 回调与 ResizeObserver 共用,隐藏幕布绝不外发尺寸。 */
    const syncSize = () => {
      if (!container.clientWidth) {
        needsForceSyncRef.current = true;
        return;
      }
      /* 列宽重排后保阅读位(含 SIGWINCH 抹除重印感知,见 terminalScrollKeeper.reflow)。 */
      scrollKeeper.reflow(term, () => fit.fit());
      host.resizeSession(sessionId, term.cols, term.rows, needsForceSyncRef.current);
      needsForceSyncRef.current = false;
    };
    /* 外观页改字号/字体 → 活幕布即时重排(fit 后同步 PTY 尺寸,同窗口 resize 语义)。
       必须经 syncSize:无守卫的 fit+resize 会把不可见会话的 PTY 钳成 2 列窄条重排
       (settings 写入面极广:置顶/重命名/归档/工作区过滤等日常动作都触发)。 */
    const offFontSettings = subscribeSettings(() => {
      const s = getSettingsState().settings;
      term.options.fontSize = s.terminalFontSize;
      term.options.fontFamily = resolveTerminalFontFamily(s.terminalFontFamily);
      syncSize();
    });
    term.loadAddon(fit);
    term.loadAddon(search);
    /* 链接点击 → 系统浏览器(Tauri webview 内 window.open 不可靠,走 shell 插件)。 */
    term.loadAddon(new WebLinksAddon((_event, uri) => void openExternalUrl(uri)));
    /* 插件链接提供者(回链定位等,terminalLinks 注册表;幕布外点缀零字节触碰)。 */
    attachTerminalLinks(term);
    /* 聚焦态馈入分发器:聚焦期 terminal 作用域优先、global ⌘ 系键照常触发
       (命中即拦截零 PTY 字节,未命中键原样进 PTY)——分发决策见 shortcuts.ts
       resolveCommand。xterm v6 无 onFocus/onBlur 事件,借容器 focusin/focusout(冒泡可达)。 */
    const onFocusIn = () => setTerminalFocused(true);
    const onFocusOut = () => setTerminalFocused(false);
    container.addEventListener("focusin", onFocusIn);
    container.addEventListener("focusout", onFocusOut);
    term.open(container);
    /* 渲染器 = xterm 内建 DOM:WebGL glyph atlas 长跑后被 WebKit texSubImage2D
       大纹理子上传 bug 损坏成马赛克且 onContextLoss 不触发,已弃用;addon-canvas
       停更 xterm 5 时代装不上 ^6。DOM 渲染器是核心兜底。ponytail: 全屏 TUI
       重绘性能不达标时复评(webgl 上游修复 或 addon-canvas 适配 v6)。 */
termRef.current = term;
    searchRef.current = search;

    const pager = new TerminalHistoryPager(sessionId, inputGate, (h, l) => {
      setHasMore(h);
      setLoadingHistory(l);
    });
    pagerRef.current = pager;
    /* 翻页器随挂载创建(keep-alive 后每会话仅挂载一次);输出装配见 terminalReplay.ts。 */
    streamReadyRef.current = false; let disposed = false; const streamReady = Promise.withResolvers<void>(); const disposal = Promise.withResolvers<void>();
    lastLiveAtRef.current = 0;
    const offStream = attachTerminalStream(term, sessionId, inputGate, setLoadProgress, () => {
      streamReadyRef.current = true; streamReady.resolve();
    }, {
      shouldDefer: () => !activeRef.current,
      bindFlush: (flush) => {
        flushDeferredRef.current = flush;
      },
    }, () => {
      lastLiveAtRef.current = Date.now();
    });

    /* 翻页锚点初始化(缓冲起点绝对偏移反推,实现见 terminalHistory.ts)。 */
    const pagerReady = pager.init().catch(() => undefined);
    /* 滚动到顶才显示"加载更早的输出"入口 */
    setAtTop(term.buffer.active.viewportY === 0);
    const offScroll = term.onScroll((y) => {
      setAtTop(y === 0);
      scrollKeeper.record(term, activeRef.current, container.clientWidth > 0);
    });
    /* Ask 屏幕采样探针(语义与贴底闸见 terminalCanvasHealth.startAskScreenProbe)。 */
    const stopAskProbe = startAskScreenProbe(term, sessionId, () => streamReadyRef.current);
    /* 幕布数据链停滞探针(PTY 在流而幕布不吃字节 → 自动重建;判据见 canvasStall.ts)。 */
    const stopStallProbe = startCanvasStallProbe({
      sessionId,
      isActive: () => activeRef.current,
      isStreamReady: () => streamReadyRef.current,
      getLastLiveAt: () => lastLiveAtRef.current,
      onRebuild: () => setCanvasGen((g) => g + 1),
    });
    /* 闸外照常写会话;闸窗内只弃用户形态输入、放行整段终端协议回传(标 synthetic,
       非用户输入不锚定对话)—— 活查询的应答远端正在等,回放窗也可能接到
       (连接先于挂载完成时 CPR 落缓冲走回放,见 terminalInputGate.ts 头注)。 */
    const offInput = term.onData((data) => {
      if (shouldSuppressProbeReply(host, sessionId, data) || (inputGate.blocked() && !isTerminalReport(data))) return;
      host.writeSession(sessionId, data, isTerminalReport(data));
    });
    /* 对话锚点:向内核注册本幕布的跳转/定位能力(composer 锚点栏经此中转)。 */
    const terminalHandle: TerminalHandle = {
      lineText: (row) => term.buffer.active.getLine(row)?.translateToString(true) ?? "",
      bufferLength: () => term.buffer.active.length,
      viewportTop: () => term.buffer.active.viewportY,
      rows: () => term.rows, settled: () => settleTerminalJump(term, { pager: pagerReady, stream: streamReady.promise, history: () => pager.settled(), flush: () => flushDeferredRef.current?.(), disposed: () => disposed, disposal: disposal.promise }),
      scrollToLine: (row) => { scrollKeeper.cancel(); term.scrollToLine(row); },
      focus: () => termRef.current?.focus(),
      onScroll: (cb) => {
        const d = term.onScroll(cb);
        return () => d.dispose();
      },
      hasMoreHistory: () => pager.hasMoreHistory(),
      loadEarlier: () => loadEarlierRef.current?.() ?? Promise.resolve(),
    };
    registerTerminalHandle(sessionId, terminalHandle);

    /* 重挂载必发一次(needsForceSync 初值 true 强制真 SIGWINCH 整帧重绘,根治错栅格滞留);重绘由活动守望抑制窗吸收。 */
    syncSize();
    const offObserve = observeCanvasSize(container, syncSize);

    return () => {
      disposed = true; disposal.resolve(); streamReady.resolve(); stopAskProbe();
      stopStallProbe();
      offTokens();
      offFontSettings();
      container.removeEventListener("focusin", onFocusIn);
      container.removeEventListener("focusout", onFocusOut);
      /* 先冲刷 250ms 合帧攒帧再存快照(尾巴已计水位不在投影,跳过则 fast 永久缺字);终态收尾须先于注销 handle。 */
      flushDeferredRef.current?.();
      settleTerminalFreeze(sessionId, term);
      unregisterTerminalHandle(sessionId, terminalHandle);
      offStream();
      offInput.dispose();
      offScroll.dispose(); scrollKeeper.dispose(); /* keeper 停守望 timer/rAF,已卸载 term 不再被轮询 */
      offObserve();
      term.dispose();
      termRef.current = null;
      searchRef.current = null;
      pagerRef.current = null;
      setSearchOpen(false);
      setHasMore(false);
      setLoadingHistory(false);
    };
  }, [sessionId, inputGate, canvasGen, scrollKeeper]);

  /* ⌘F 搜索框所有权 + 关闭回调(实现见 terminalSearch.useSearchBoxOwnership)。 */
  const { close: closeSearch } = useSearchBoxOwnership(active, setSearchOpen, termRef);

  /* loadEarlier 实例内恒稳定(useCallback 无依赖),ref 转交放 effect 避免渲染期写。 */
  useEffect(() => {
    loadEarlierRef.current = loadEarlier;
  }, [loadEarlier]);
  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="terminal-view-host h-full w-full" />
      <TerminalLoadOverlay progress={loadProgress} />
      {atTop && hasMore && (
        <button
          onClick={() => void loadEarlier()} disabled={loadingHistory}
          className="absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-md border border-(--tmd-border) bg-(--tmd-bg-popover) px-3 py-1 text-xs text-(--tmd-accent) shadow-(--tmd-shadow-popover) hover:bg-(--tmd-bg-hover) disabled:opacity-50"
        >
          {loadingHistory ? t("加载中…") : t("↑ 加载更早的输出")}
        </button>
      )}
      {searchOpen && (
        <TerminalSearchOverlay
          searchRef={searchRef}
          termRef={termRef}
          onClose={closeSearch}
          logSearch={makeLogSearchBridge(sessionId, pagerRef, termRef)}
        />
      )}
      <TerminalCopyMenu termRef={termRef} sessionId={sessionId} active={active} />
      <TerminalToolRow termRef={termRef} onRefresh={() => setCanvasGen((g) => g + 1)} />
    </div>
  );
}

export const TerminalView = memo(TerminalViewImpl);
