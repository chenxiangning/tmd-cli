/**
 * 幕布滚动位置保持 —— keep-alive 幕布经 display:none 隐藏后重显时,盒模型销毁把
 * xterm ydisp 打回 0(实测 WebKit);平铺形态失活只换焦点不动滚动。本模块按
 * 「快照 - 恢复」与「重排内容锚定」两层保位:每幕布一实例,随 keep-alive 常驻
 * (useState 惰性初值,同 createReplayInputGate)。
 *
 * 重排(SIGWINCH)是重灾区:TUI CLI(omp/pi/claude 系)收到尺寸变化会走
 * 「退 alt 屏 → 2J+3J 清屏并清滚动缓冲 → 重进 alt 屏 → 整篇重印」协议(实测
 * omp 18.12 SIGWINCH 字节流),缓冲被 CLI 亲手抹掉后从 transcript 顶重画 ——
 * 视口自然停在顶。抹除期间任何位置快照都无从恢复,唯一可行的是等重印落定后
 * 按「改尺寸前视口顶行文本」在新缓冲里重锚(reflow 第二段);无重印的纯 xterm
 * 重排(ssh 裸流/非 TUI)由 raf 内容锚即席覆盖(第一段)。
 */
import { anchorText, findAnchor, findAnchorFull, type ScrollLine } from "./terminalScrollAnchor";

/** 最小依赖面(真 Terminal 结构子集;单测假体同形)。getLine 供重排内容锚定,
 *  rows/cols 供尺寸变化判定,buffer.length 供抹除/重印探测;缺省退化为旧行为。 */
export interface ScrollableTerm {
  readonly rows?: number;
  readonly cols?: number;
  readonly buffer: {
    readonly active: {
      readonly viewportY: number;
      readonly baseY: number;
      readonly length?: number;
      getLine?(row: number): ScrollLine | undefined;
    };
  };
  scrollToLine(row: number): void;
  scrollToBottom(): void;
  /** 真实 xterm 的挂载根(enforcement 用户输入让位监听挂这里;假体缺省跳过)。 */
  readonly element?: HTMLElement;
}

/** 滚动位快照:ydisp + 是否贴底(ydisp >= baseY ⟺ 吸底)。 */
interface Snapshot {
  y: number;
  atBottom: boolean;
}

const snap = (term: ScrollableTerm): Snapshot => {
  const b = term.buffer.active;
  const y = b.viewportY;
  return { y, atBottom: y >= b.baseY };
};

export interface ScrollKeeper {
  /** 活性且可见期持续记录;隐藏期 ydisp 可能被打回 0,不得覆盖真值。 */
  record(term: ScrollableTerm, active: boolean, visible: boolean): void;
  /** 失活时判定是否真被隐藏(容器零宽;平铺形态失活只换焦点,不算)。 */
  markHidden(container: { clientWidth: number } | null): void;
  /** 重显恢复(未真隐藏则 no-op);恢复后重记快照,防隐藏期污染值残留。 */
  restore(term: ScrollableTerm | null): void;
  /** 收兵 enforcement(测试与 dispose 收尾用;生产让位由 armEnforce 自挂 term.element 的
   *  wheel/pointerdown/touchstart 监听完成,TerminalView 不经此转发)。 */
  cancelEnforcement(): void;
  /** 幕布卸载收尾:停重印守望 timer 与 enforcement,已卸载 term 不再被轮询。 */
  dispose(): void;
  /** 尺寸变化重排保位:raf 内容锚(第一段)+ WebKit 重置 enforcement 窗 + SIGWINCH 抹除重印感知重锚(第二段)。 */
  reflow(term: ScrollableTerm, fit: () => void): void;
}

/* —— SIGWINCH 重印感知 —— */
const REPRINT_POLL_MS = 120;
const REPRINT_STALL_POLLS = 3; /* 连续 3 拍缓冲行数不变 → 重印落定 */
const REPRINT_DETECT_MAX = 12; /* 抹除未出现:探测约 1.4s 后解除(第一段已覆盖) */
const REPRINT_MAX_POLLS = 84; /* 硬超时约 10s(泵聚合下重印至多数秒) */

const raf: (cb: () => void) => void =
  typeof requestAnimationFrame === "function"
    ? (cb) => void requestAnimationFrame(cb)
    : (cb) => void setTimeout(cb, 16);

/** 定时器句柄(activityReport.TimerHandle 同款;DOM number / node Timeout 双态)。 */
type TimerHandle = ReturnType<typeof setTimeout>;

export function createScrollKeeper(): ScrollKeeper {
  let saved: Snapshot | null = null;
  let hiddenByHide = false;
  /* 重印感知:gen 防过期回调(watchGen 每次写),timer 单飞(新 reflow 顶替旧 watch)。 */
  let watchGen = 0;
  let watchTimer: TimerHandle | null = null;
  const disarm = (): void => {
    if (watchTimer) {
      clearTimeout(watchTimer);
      watchTimer = null;
    }
  };

  /** 第二段:探测「缓冲腰斩(抹除)→ 行数停涨(重印落定)」后全缓冲重锚。
   *  用户在窗口期(≤10s)滚轮是可接受竞态:重印本身就在改写缓冲。 */
  const armReprintWatch = (
    term: ScrollableTerm,
    anchor: string,
    preLen: number,
    myGen: number,
  ): void => {
    disarm();
    let polls = 0;
    let collapsed = false;
    let lastLen = -1;
    let stall = 0;
    const tick = (): void => {
      watchTimer = null;
      if (myGen !== watchGen) return;
      const b = term.buffer.active;
      const len = b.length ?? 0;
      polls += 1;
      if (!collapsed) {
        if (preLen > 0 && len < preLen * 0.5) {
          collapsed = true;
          lastLen = len;
          stall = 0;
        } else if (polls >= REPRINT_DETECT_MAX) {
          return; /* 无抹除:纯 xterm 重排,第一段已处理 */
        }
      } else if (len === lastLen) {
        stall += 1;
        if (stall >= REPRINT_STALL_POLLS) {
          const found = findAnchorFull(b, anchor);
          if (found >= 0 && found !== b.viewportY) term.scrollToLine(found);
          return;
        }
      } else {
        lastLen = len;
        stall = 0;
      }
      if (polls >= REPRINT_MAX_POLLS) return;
      watchTimer = setTimeout(tick, REPRINT_POLL_MS);
    };
    watchTimer = setTimeout(tick, REPRINT_POLL_MS);
  };

  /* 重排后 enforcement 窗:WebKit 布局变化时反复重置滚动容器 scrollTop,xterm 从
   * DOM scrollTop 反推 ydisp 归零(真机实测:面板开合后 vp=0 而缓冲完好;Chromium
   * 保 scrollTop 故桩不复现)。动画期每帧都可能再重置,raf 单发锚点打不赢 ——
   * 窗内(~800ms)持续按内容锚钉回,用户输入(wheel/pointerdown/touchstart)立即让位。 */
  let enforce: {
    term: ScrollableTerm;
    anchor: string;
    center: number;
    until: number;
    gen: number;
    offInput: () => void;
  } | null = null;

  const stopEnforce = (): void => {
    enforce?.offInput();
    enforce = null;
  };

  const armEnforce = (term: ScrollableTerm, anchor: string, center: number, gen: number): void => {
    stopEnforce();
    const el = term.element;
    const onInput = (): void => stopEnforce();
    /* 键盘滚动意图键(PageUp/PageDown/Home/End,含 shift 组合)经 xterm
       textarea 冒泡到挂载根 —— 不让位则窗内 shift+PageUp 被钉回锚行。 */
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "PageUp" || e.key === "PageDown" || e.key === "Home" || e.key === "End") {
        stopEnforce();
      }
    };
    /* 用户主动输入 = 立即让位(重置窗内滚轮不被对抗)。 */
    el?.addEventListener("wheel", onInput, { passive: true });
    el?.addEventListener("pointerdown", onInput);
    el?.addEventListener("touchstart", onInput, { passive: true });
    el?.addEventListener("keydown", onKey);
    enforce = {
      term,
      anchor,
      center,
      until: Date.now() + 800,
      gen,
      offInput: () => {
        el?.removeEventListener("wheel", onInput);
        el?.removeEventListener("pointerdown", onInput);
        el?.removeEventListener("touchstart", onInput);
        el?.removeEventListener("keydown", onKey);
      },
    };
    raf(enforceTick);
  };

  const enforceTick = (): void => {
    if (!enforce) return;
    const e = enforce;
    if (e.gen !== watchGen || Date.now() > e.until) {
      stopEnforce();
      return;
    }
    const b = e.term.buffer.active;
    if (b.viewportY >= b.baseY) {
      stopEnforce(); /* 到底:用户意图或跟随接管,停钉 */
      return;
    }
    const found = findAnchor(b, e.anchor, e.center);
    if (found < 0) {
      stopEnforce(); /* 锚内容不在邻域(舞步注入/重印):让位给重印守望 */
      return;
    }
    e.center = found;
    if (b.viewportY !== found) e.term.scrollToLine(found);
    raf(enforceTick);
  };

  return {
    /** 收兵 enforcement(测试与 dispose;生产让位走 armEnforce 自挂监听)。 */
    cancelEnforcement(): void {
      stopEnforce();
    },
    dispose(): void {
      watchGen += 1; /* 作废在飞 raf 重入(gen 守卫自检) */
      stopEnforce();
      if (watchTimer !== null) {
        clearTimeout(watchTimer);
        watchTimer = null;
      }
    },
    record(term: ScrollableTerm, active: boolean, visible: boolean): void {
      if (active && visible) saved = snap(term);
    },
    markHidden(container: { clientWidth: number } | null): void {
      if (container && container.clientWidth === 0) hiddenByHide = true;
    },
    restore(term: ScrollableTerm | null): void {
      if (!hiddenByHide) return;
      hiddenByHide = false;
      if (!term || !saved) return;
      if (saved.atBottom) term.scrollToBottom();
      else term.scrollToLine(saved.y);
      saved = snap(term);
    },
    reflow(term: ScrollableTerm, fit: () => void): void {
      const b = term.buffer.active;
      const y = b.viewportY;
      if (y >= b.baseY) {
        fit(); /* 贴底:吸底跟随语义接管 */
        return;
      }
      const anchor = anchorText(term, y);
      const pre = { cols: term.cols, rows: term.rows, len: b.length ?? 0 };
      const oldTotal = b.baseY + (term.rows ?? 0);
      fit();
      watchGen += 1;
      const myGen = watchGen;
      if (anchor && (term.cols !== pre.cols || term.rows !== pre.rows)) {
        armReprintWatch(term, anchor, pre.len, myGen);
      }
      /* 第一段:xterm 的 reflow ydisp 校正晚于 fit 返回落地(实测 fit 后同步读
         仍为旧值,+10ms 内已漂移)——落锚推迟到下一帧;估计新下标 = 旧下标 ×
         缓冲总量比(收窄重排行数膨胀,均匀比例近似)。enforcement 窗同帧启动。 */
      raf(() => {
        if (myGen !== watchGen) return;
        const nb = term.buffer.active;
        let target = y;
        let center = y;
        if (anchor) {
          const est = Math.round((y * (nb.baseY + (term.rows ?? 0))) / Math.max(1, oldTotal));
          const found = findAnchor(nb, anchor, est);
          if (found >= 0) {
            target = found;
            center = found;
          }
        }
        if (target !== nb.viewportY) term.scrollToLine(target);
        if (anchor) armEnforce(term, anchor, center, myGen);
      });
    },
  };
}
