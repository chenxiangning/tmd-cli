/**
 * 幕布滚动位置保持 —— keep-alive 幕布经 display:none 隐藏后重显时,盒模型销毁把
 * xterm viewport scrollTop 清零,WebKit 重显补发 scroll 事件令 ydisp 归零(切 tab /
 * 回首页再切回因此跳顶)。本模块记活性期滚动位、失活时标记真隐藏、重显时恢复:
 * 隐藏前贴底 → 仍吸底(实时输出跟随不受影响);中途 → 回原行。
 * 每幕布一实例,随 keep-alive 常驻(useState 惰性初值,同 createReplayInputGate)。
 */
/** 最小依赖面(真 Terminal 结构子集;单测假体同形)。getLine 供重排内容锚定,
 *  rows 供重排比例估计;缺省(旧假体)退化为索引保持。 */
export interface ScrollableTerm {
  readonly rows?: number;
  readonly buffer: {
    readonly active: {
      readonly viewportY: number;
      readonly baseY: number;
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
}

export function createScrollKeeper(): ScrollKeeper {
  let saved: Snapshot | null = null;
  let hiddenByHide = false;
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
  };
}

/** 列宽重排(fit)前后保阅读位:非贴底回原「内容」,贴底不插手(吸底跟随接管)。
 *  开/关文件、拖栏等宽度变化不再把中途阅读位甩走。
 *
 *  为什么按内容锚定而非行号:收窄重排把上方行折成更多行(缓冲膨胀),xterm 的
 *  ydisp 索引保持会让视口停在原下标 —— 同一下标在新缓冲里对应更靠前的内容,
 *  阅读位被甩向文首(点击链接开文件分栏触发收窄时,实测内容跳走半屏以上)。
 *  以视口顶行文本重锚:重排后在新缓冲里就近找同一行,跳回真正的阅读处。
 *  索引兜底:假体无 getLine 或锚行全空白时退回旧行号。 */
const ANCHOR_WALK = 8; /* 锚行:视口顶起向下找首个非空行的容忍(仍在视口内) */
const ANCHOR_CHARS = 24; /* 锚文本长度(对齐 anchorJump needle 上限) */
const ANCHOR_SCAN = 150; /* 估计点就近扫描半径;超出退回索引保持 */

const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

function anchorText(term: ScrollableTerm, from: number): string | null {
  for (let i = 0; i < ANCHOR_WALK; i++) {
    const s = norm(term.buffer.active.getLine?.(from + i)?.translateToString(true) ?? "");
    if (s) return s.slice(0, ANCHOR_CHARS);
  }
  return null;
}

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

export function reflowKeep(term: ScrollableTerm, fit: () => void): void {
  const b = term.buffer.active;
  const y = b.viewportY;
  if (y >= b.baseY) {
    fit();
    return;
  }
  const anchor = anchorText(term, y);
  /* 重排前总量(行号按换行比例膨胀的估计基准) */
  const oldTotal = b.baseY + (term.rows ?? 0);
  fit();
  /* xterm 的 reflow ydisp 校正晚于 fit 返回落地(实测 fit 后同步读仍为旧值,
     +10ms 内已漂移)——落锚推迟到下一帧,按最终缓冲状态估计并应用。 */
  raf(() => {
    const nb = term.buffer.active;
    let target = y;
    if (anchor) {
      /* 估计新下标 = 旧下标 × 缓冲总量比(收窄重排行数膨胀,均匀比例近似),
         就近扫描吸收逐行折行差异;子串匹配容忍锚行为折行续段(命中落点 =
         逻辑行首,偏差 ≤ 续行行数)。 */
      const est = Math.round((y * (nb.baseY + (term.rows ?? 0))) / Math.max(1, oldTotal));
      const found = findAnchor(nb, anchor, est);
      if (found >= 0) target = found;
    }
    if (target !== nb.viewportY) term.scrollToLine(target);
  });
}

/** rAF 的 node 测试环境回落(anchorJump 同款)。 */
const raf: (cb: () => void) => void =
  typeof requestAnimationFrame === "function"
    ? (cb) => void requestAnimationFrame(cb)
    : (cb) => void setTimeout(cb, 16);
