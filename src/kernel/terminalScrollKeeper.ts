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
}

/** 滚动位快照:ydisp + 是否贴底(ydisp >= baseY ⟺ 吸底)。 */
interface Snapshot {
  y: number;
  atBottom: boolean;
}

/** 最小行访问面(锚定重排用;真 Terminal 结构子集)。 */
interface ScrollLine {
  translateToString(trimRight?: boolean): string;
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
  /** 尺寸变化重排保位:raf 内容锚(第一段)+ SIGWINCH 抹除重印感知重锚(第二段)。 */
  reflow(term: ScrollableTerm, fit: () => void): void;
}

/* —— 重排内容锚定 —— */
const ANCHOR_WALK = 8; /* 锚行:视口顶起向下找首个非空行的容忍(仍在视口内) */
const ANCHOR_CHARS = 24; /* 锚文本长度(对齐 anchorJump needle 上限) */
const ANCHOR_SCAN = 150; /* 第一段估计点就近扫描半径;超出退回索引保持 */

/* —— SIGWINCH 重印感知 —— */
const REPRINT_POLL_MS = 120;
const REPRINT_STALL_POLLS = 3; /* 连续 3 拍缓冲行数不变 → 重印落定 */
const REPRINT_DETECT_MAX = 12; /* 抹除未出现:探测约 1.4s 后解除(第一段已覆盖) */
const REPRINT_MAX_POLLS = 84; /* 硬超时约 10s(泵聚合下重印至多数秒) */

const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

function anchorText(term: ScrollableTerm, from: number): string | null {
  for (let i = 0; i < ANCHOR_WALK; i++) {
    const s = norm(term.buffer.active.getLine?.(from + i)?.translateToString(true) ?? "");
    if (s) return s.slice(0, ANCHOR_CHARS);
  }
  return null;
}

/** 就近扫描:自 from 向外找含锚文本的行(锚行可能是折行续段,用子串匹配)。 */
function findAnchor(
  b: ScrollableTerm["buffer"]["active"],
  anchor: string,
  from: number,
): number {
  /* 行文本读取收敛单点:探测循环每次取不同行,非重复查表 */
  const lineAt = (row: number): string =>
    norm(b.getLine?.(row)?.translateToString(true) ?? "");
  for (let d = 0; d <= ANCHOR_SCAN; d++) {
    // react-doctor-disable-next-line react-doctor/js-set-map-lookups -- 行缓冲就近探测,每行至多取一次,无重复查表可消
    if (lineAt(from + d).includes(anchor)) return from + d;
    // react-doctor-disable-next-line react-doctor/js-set-map-lookups -- 同上反向臂
    if (d > 0 && lineAt(from - d).includes(anchor)) return from - d;
  }
  return -1;
}

/** 全缓冲扫描(重印重锚用):重印从 transcript 顶重建,锚可落在任意处。 */
function findAnchorFull(
  b: ScrollableTerm["buffer"]["active"],
  anchor: string,
): number {
  const len = b.length ?? 0;
  for (let row = 0; row < len; row++) {
    // react-doctor-disable-next-line react-doctor/js-set-map-lookups -- 全缓冲单遍扫描,每行至多取一次
    if (norm(b.getLine?.(row)?.translateToString(true) ?? "").includes(anchor)) return row;
  }
  return -1;
}

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

  return {
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
         仍为旧值,+10ms 内已漂移)——落锚推迟到下一帧,按最终缓冲状态估计。
         估计新下标 = 旧下标 × 缓冲总量比(收窄重排行数膨胀,均匀比例近似)。 */
      raf(() => {
        if (myGen !== watchGen) return;
        const nb = term.buffer.active;
        let target = y;
        if (anchor) {
          const est = Math.round((y * (nb.baseY + (term.rows ?? 0))) / Math.max(1, oldTotal));
          const found = findAnchor(nb, anchor, est);
          if (found >= 0) target = found;
        }
        if (target !== nb.viewportY) term.scrollToLine(target);
      });
    },
  };
}
