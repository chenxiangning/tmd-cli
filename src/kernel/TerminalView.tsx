/**
 * 幕布终端 —— xterm.js 透传 PTY 字节流(幕布零渲染原则的唯一实现点)。
 *
 * 生命周期:挂载 → 回放内核输出缓冲(切回不黑屏)→ 订阅实时总线。
 * 输入路径:xterm onData 直写 PTY;富 composer 实装后汇入同一条 write 通道。
 * 渲染层:xterm 内建 DOM 渲染器(WKWebView + WebglAddon glyph atlas 长时间运行后
 * 会因 WebKit texSubImage2D 缺陷静默损坏成马赛克——已弃用)。
 * 点缀层:Cmd/Ctrl+F 搜索、可点击链接 —— 纯 xterm 插件,不触碰字节流。
 *
 * 文件规模铁则拆分(300 行):历史翻页器在 terminalHistory.ts,
 * 搜索浮层与 terminal.find 命令桥在 terminalSearch.tsx,
 * 加载遮罩在 terminalLoadOverlay.tsx,保底刷新钮在 terminalRefreshButton.tsx。
 */

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { openExternalUrl } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { getSettingsState, subscribeSettings } from "@kernel/settings";
import { resolveTerminalFontFamily } from "@kernel/terminalFonts";
import { host } from "@kernel/host";
import { Mounts } from "@kernel/Mounts";
import {
  registerTerminalHandle,
  unregisterTerminalHandle,
  type TerminalHandle,
} from "@kernel/messageAnchors";
import { subscribeTerminalTheme } from "@kernel/terminalThemeBridge";
import { createReplayInputGate } from "@kernel/terminalInputGate";
import { attachTerminalStream, type LoadProgress } from "@kernel/terminalReplay";
import { isTerminalReport, shouldSuppressProbeReply } from "@kernel/terminalReports";
import { TerminalHistoryPager } from "@kernel/terminalHistory";
import { TerminalSearchOverlay } from "@kernel/terminalSearch";
import { findRequestRef } from "@kernel/terminalFindBridge";
import { TerminalCopyMenu } from "@kernel/terminalCopyMenu";
import { TerminalLoadOverlay } from "@kernel/terminalLoadOverlay";
import { TerminalRefreshButton } from "@kernel/terminalRefreshButton";
import { attachTerminalLinks } from "@kernel/terminalLinks";
import { setTerminalFocused } from "@kernel/shortcuts";
import { readTerminalTheme } from "@kernel/terminalXtermTheme";

/** 从文档计算样式读终端 token → xterm theme(实现见 kernel/terminalXtermTheme.ts)。 */
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
  /* 加载进度态:null = 就绪撤罩(terminalReplay.ts);streamReadyRef = 幕布流就绪相位(onReady 置位),askProbe 停采判据(评审 F5/P1-2)。 */
  const [loadProgress, setLoadProgress] = useState<LoadProgress>(null);
  const streamReadyRef = useRef(false);
  const pagerRef = useRef<TerminalHistoryPager | null>(null);
  /* 历史重写输入闸:回放/翻页重写期间丢弃 xterm 对历史查询的自动应答(见 terminalInputGate.ts);
     实例随会话 keep-alive 常驻;惰性初值 = useState 初始化器只在首帧执行一次。 */
  const [inputGate] = useState(createReplayInputGate);
  /* 翻页器(实现见 terminalHistory.ts):锚点/前缀页/重入闸随实例持有,hasMore/loading 经 onState 回喂。 */
  /** 幕布重建代数:刷新钮自增 → 主 effect 重跑 = xterm 销毁重建 + 缓冲回放 +
      强制 SIGWINCH 整帧重绘(needsForceSync 初值 true),PTY/CLI 不中断。
      会话内自救:幕布错乱/内容滞留时手动出口;WebKit 级像素冻结归守望阶梯。 */
  const [canvasGen, setCanvasGen] = useState(0);
  /** 隐藏幕布合帧写入(Fix B,terminalReplay.ts):activeRef 是活性真相(effect
     保持最新,避免闭包吃陈旧 prop);激活即冲刷攒帧,切换无感。 */
  const activeRef = useRef(active);
  const flushDeferredRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    activeRef.current = active;
    if (active) flushDeferredRef.current?.();
  }, [active]);
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
      fit.fit();
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
    /* 渲染器 = xterm 内建 DOM(WKWebView 弃用 WebGL 方案):
       此前 loadAddon(new WebglAddon()) 的 glyph atlas 长时间运行后
       会被 WebKit 的 texSubImage2D 大纹理子上传 bug 损坏成马赛克
       (atlas 越大越易触发,且 onContextLoss 不触发静默损坏——大仙
       反馈"运行时间长,渲染乱码"即此)。addon-canvas 停更在 xterm 5 时代,
       装不上 ^6。DOM 渲染器作为 xterm 核心兜底,Linux WebKitGTK 等无
       WebGL 环境原本就在跑此路径。
       ponytail: 若全屏 TUI 重绘性能实测不达标,复评
       (webgl 上游 WebKit 修复 或 addon-canvas 适配 v6)。*/
    termRef.current = term;
    searchRef.current = search;

    const pager = new TerminalHistoryPager(sessionId, inputGate, (h, l) => {
      setHasMore(h);
      setLoadingHistory(l);
    });
    pagerRef.current = pager;
    /* 翻页器随挂载创建(keep-alive 后每会话仅挂载一次);输出装配见 terminalReplay.ts。 */
    streamReadyRef.current = false;
    const offStream = attachTerminalStream(term, sessionId, inputGate, setLoadProgress, () => {
      streamReadyRef.current = true;
    }, {
      shouldDefer: () => !activeRef.current,
      bindFlush: (flush) => {
        flushDeferredRef.current = flush;
      },
    });

    /* 翻页锚点初始化(缓冲起点绝对偏移反推,实现见 terminalHistory.ts)。 */
    void pager.init();

    /* 滚动到顶才显示"加载更早的输出"入口 */
    setAtTop(term.buffer.active.viewportY === 0);
    const offScroll = term.onScroll((y) => setAtTop(y === 0));
    /* Ask 屏幕态采样(askWatch v3):omp 等待期间 spinner 以光标寻址持续重绘,
       面板标记一旦流出字节尾窗永不复现(实测 3h 挂起面板后流 7.4MB)——
       字节流检测对此原理性无解,但屏幕上标记始终在:贴底时采整个视口喂检测器
       (与后台镜像全屏同口径;omp 大窗口面板在中上部、底部留空,固定底窗
       8→24 行两代都被实测证伪——2026-09-29 大窗实测标记距屏底 30-38 行)。
       贴底闸:用户上翻历史时旧已答对话框会入视野,采样会假置位——非贴底停采
       (状态冻结不误摘,作答/超时仍由字节流与写路径清位)。
       就绪前(回放/流式相位)停采:磁盘回放的墓碑帧不进屏幕通道,Ask 恢复
       只走 restoreTail(评审 F5)。 */
    const askProbe = setInterval(() => {
      if (!streamReadyRef.current) return; /* 就绪前墓碑帧不进屏幕通道 */
      const buf = term.buffer.active;
      if (buf.baseY + term.rows < buf.length - 2) return; /* 上翻中:停采防旧卡假置位 */
      const bottom = Math.min(buf.length, buf.baseY + term.rows);
      let screenTail = "";
      for (let row = buf.baseY; row < bottom; row++) {
        screenTail += (buf.getLine(row)?.translateToString(true) ?? "") + "\n";
      }
      host.observeAskScreen(sessionId, screenTail);
      /* 250ms:置位延迟 ≈ ASK_CONFIRM_MS + 采样间隔;旧 1Hz 实测 2-3s,用户体感慢。 */
    }, 250);
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

    /* 重挂载必发一次(needsForceSync 初值 true:重挂载即强制一次真 SIGWINCH 整帧
       重绘,根治关闭再开/切回后的错栅格滞留);重绘由活动守望抑制窗吸收。 */
    syncSize();
    const observer = new ResizeObserver(syncSize);
    observer.observe(container);

    return () => {
      clearInterval(askProbe);
      offTokens();
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
  }, [sessionId, inputGate, canvasGen]);

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
        <TerminalSearchOverlay searchRef={searchRef} onClose={closeSearch} />
      )}
      <TerminalCopyMenu termRef={termRef} sessionId={sessionId} active={active} />
      {/* 幕布右上工具行:插件工具钮(terminal.canvasRow 挂点)+ 刷新钮收尾最右。
          行不设 z —— 画布浮层(editorCenter.canvasOverlay,z-10 不透明)开启时
          整行隐没其下,结构化视图页不出刷新钮;幕布态浮于 xterm 之上(DOM 序)。 */}
      <div className="absolute right-3 top-2 flex items-center gap-1.5">
        <Mounts point="terminal.canvasRow" />
        <TerminalRefreshButton onClick={() => setCanvasGen((g) => g + 1)} />
      </div>
    </div>
  );
}

export const TerminalView = memo(TerminalViewImpl);
