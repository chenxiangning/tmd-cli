/**
 * 手机实况屏 —— 迷你 VT 视口模型(固定 H×W 行缓冲 + 光标 + 触底上滚)。
 * omp 全程 alt-screen + 绝对 CUP 定位重绘(实证:页脚钉第 31/33 行,视口高约 34),
 * 无滚动区/插删行。上一版无固定视口:正文一超行,CUP(31) 就落回文档中段盖正文、
 * 页脚散落多行 = 重复(真机三次实证)。正解 = 忠实终端:固定高度,LF 到底上滚,
 * 按列换行(DECAWM 可关),CUP 夹在视口内 → 重绘天然收敛为一份。
 * 滚出视口的行进 scrollback(上限 SCROLL_CAP 行),view(fromTop) 可取全量历史,
 * 手机实况区因此能向上滚动看旧输出。
 * 支持集:可打印、\n \r \t \b、CSI H/f/A/B/C/D/E/G/J/K/M/s/u、2J/3J、
 * 模式 ?7h/l(换行)?1049h/l(备屏清屏);SGR/其余忽略。桌面幕布用真 xterm,不共享。
 */

/** 视口尺寸取不到时的回落(SSH/未知会话)。 */
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
/** 单行宽度硬顶(异常 CUP 列的止损)。 */
const MAX_LINE = 4000;
/** 滚出视口行的保留上限(内存止损)。 */
const SCROLL_CAP = 2000;

/* 已闭合序列的锚定判据(与切分器同源);tail 用它识别「还没收完」的转义。 */
const CSI_FULL = /^\x1b\[[0-9:;<=>?]*[ -/]*[@-~]/;
const OSC_FULL = /^\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/;

/** 以 ESC 起头且尚未闭合(CSI 缺终字节 / OSC 缺 BEL|ST / 字符集缺设计者)。 */
function incompleteEsc(t: string): boolean {
  if (t === "\x1b") return true;
  if (t.startsWith("\x1b[")) return !CSI_FULL.test(t);
  if (t.startsWith("\x1b]")) return !OSC_FULL.test(t);
  return t === "\x1b(" || t === "\x1b)" || t === "\x1b#";
}

export class LiveScreen {
  private lines: string[] = [];
  /** 滚出视口的行(有界;view() = scrollback + 视口,实况区因此可向上滚动看旧输出)。 */
  private scrollback: string[] = [];
  private row = 0;
  private col = 0;
  private savedRow = 0;
  private savedCol = 0;
  /** DECAWM:自动换行开关(omp 画页脚时临时关掉)。 */
  private wrap = true;
  private rows: number;
  private cols: number;
  /* 切分器:OSC / CSI / 单字节转义 / 控制字符各自成段,段间 = 待写文本。 */
  private readonly tok = new RegExp(
    // eslint-disable-next-line no-control-regex -- 终端控制流本就是控制字节
    "\\x1b\\][^\\x07\\x1b]*(?:\\x07|\\x1b\\\\)|\\x1b\\[[0-9:;<=>?]*[ -/]*[@-~]|\\x1b[()#][0-9A-Za-z]?|[\\x00-\\x1a\\x1c-\\x1f\\x7f]",
    "g",
  );
  /** 跨 chunk 切断的未完成转义序列(真 PTY 分块会把 CSI/OSC 拦腰切)。 */
  private pending = "";

  constructor(cols = DEFAULT_COLS, rows = DEFAULT_ROWS) {
    this.cols = Math.max(1, Math.min(cols || DEFAULT_COLS, MAX_LINE));
    this.rows = Math.max(1, Math.min(rows || DEFAULT_ROWS, 500));
  }

  /** 追加一段原始 PTY 字节(含 ANSI);视口状态增量更新。 */
  feed(chunk: string): void {
    const data = this.pending + chunk;
    this.pending = "";
    const re = this.tok;
    re.lastIndex = 0;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(data))) {
      if (m.index > last) this.print(data.slice(last, m.index));
      last = m.index + m[0].length;
      const c = m[0];
      if (c.charCodeAt(0) === 0x1b) this.escape(c);
      else if (c === "\n") this.lineFeed();
      else if (c === "\r") this.col = 0;
      else if (c === "\t") this.col = Math.min(((this.col >> 3) + 1) << 3, this.cols - 1);
      else if (c === "\b") this.col = Math.max(0, this.col - 1);
      /* 其余控制字符(BEL/DEL/转义残留):纯文本视口无关。 */
    }
    if (last < data.length) this.tail(data.slice(last));
  }

  /**
   * 全量内容 = scrollback + 当前视口(去尾部空行)。实况区直接渲染它并允许向上滚动;
   * fromTop 取前 N 行(供「跳到顶」)。alt-screen 切换会清 scrollback(见 clear)。
   */
  view(): string {
    let end = this.lines.length;
    while (end > 0 && !this.lines[end - 1]) end--;
    return [...this.scrollback, ...this.lines.slice(0, end)].join("\n");
  }

  /** 尾段处理:以 ESC 起头的未完成序列进 pending,其余落屏。 */
  private tail(t: string): void {
    const esc = t.lastIndexOf("\x1b");
    if (esc >= 0 && incompleteEsc(t.slice(esc))) {
      if (esc > 0) this.print(t.slice(0, esc));
      this.pending = t.slice(esc);
      /* 永不闭合的垃圾 ESC 串:超上限当文本吐掉,防 pending 泄漏。 */
      if (this.pending.length > 4096) {
        this.print(this.pending);
        this.pending = "";
      }
      return;
    }
    this.print(t);
  }

  private escape(c: string): void {
    if (c === "\x1b7" || c === "\x1b8") {
      if (c === "\x1b7") {
        this.savedRow = this.row;
        this.savedCol = this.col;
      } else {
        this.row = this.savedRow;
        this.col = this.savedCol;
      }
      return;
    }
    if (c.charCodeAt(1) !== 0x5b) return; // 字符集/其余转义:忽略
    const body = c.slice(2, -1);
    const final = c.charCodeAt(c.length - 1);
    if (body.charCodeAt(0) === 0x3f /* ? */) {
      /* 备屏切换进/出都清屏:模型不存主备双屏,切换点即新屏起点。 */
      if (/\?(47|1047|1049)[hl]$/.test(c)) this.clear();
      else if (/\?7h$/.test(c)) this.wrap = true;
      else if (/\?7l$/.test(c)) this.wrap = false;
      /* 其余 ? 模式(光标/批处理/鼠标):纯文本视口无关。 */
      return;
    }
    const nums = body.match(/\d+/g)?.map(Number) ?? [];
    const p = (i: number, d: number) => (nums[i] !== undefined && nums[i] !== 0 ? nums[i] : d);
    switch (final) {
      case 0x48 /* H */:
      case 0x66 /* f */:
        this.row = Math.min(Math.max(0, p(0, 1) - 1), this.rows - 1);
        this.col = Math.min(Math.max(0, p(1, 1) - 1), this.cols - 1);
        break;
      case 0x41 /* A */:
        this.row = Math.max(0, this.row - p(0, 1));
        break;
      case 0x42 /* B */:
        this.row = Math.min(this.rows - 1, this.row + p(0, 1));
        break;
      case 0x43 /* C */:
        this.col = Math.min(this.cols - 1, this.col + p(0, 1));
        break;
      case 0x44 /* D */:
      case 0x47 /* G */:
        this.col = final === 0x47 ? Math.max(0, p(0, 1) - 1) : Math.max(0, this.col - p(0, 1));
        break;
      case 0x4d /* M */:
        this.reverseLineFeed(p(0, 1));
        break;
      case 0x4a /* J */: {
        const mode = nums[0] ?? 0;
        if (mode === 2 || mode === 3) this.clear();
        else this.eraseLine(mode);
        break;
      }
      case 0x4b /* K */:
        this.eraseLine(nums[0] ?? 0);
        break;
      case 0x73 /* s */:
        this.savedRow = this.row;
        this.savedCol = this.col;
        break;
      case 0x75 /* u */:
        this.row = Math.min(this.savedRow, this.rows - 1);
        this.col = Math.min(this.savedCol, this.cols - 1);
        break;
      default:
        break; // SGR/其余 CSI:纯文本视口无关
    }
  }

  /** 打印文本(含 DECAWM 换行 + 触底上滚)。 */
  private print(s: string): void {
    for (const ch of s) {
      if (this.wrap && this.col >= this.cols) {
        this.col = 0;
        this.lineFeed();
      }
      const line = this.lines[this.row] ?? "";
      const at = Math.min(this.col, MAX_LINE);
      this.lines[this.row] =
        line.slice(0, at).padEnd(at, " ") + ch + line.slice(at + 1);
      if (this.col < this.cols) this.col++;
    }
  }

  private lineFeed(): void {
    if (this.row >= this.rows - 1) {
      const gone = this.lines.shift() ?? "";
      this.scrollback.push(gone);
      if (this.scrollback.length > SCROLL_CAP) this.scrollback.splice(0, this.scrollback.length - SCROLL_CAP);
      this.lines.push("");
    } else {
      this.row++;
    }
    this.col = 0;
  }

  private reverseLineFeed(n: number): void {
    /* 上滚到顶时把内容下推(极少用;保守:仅夹行不空滚)。 */
    this.row = Math.max(0, this.row - n);
    this.col = 0;
  }

  private eraseLine(mode: number): void {
    const line = this.lines[this.row] ?? "";
    if (mode === 2 || mode === 3) this.lines[this.row] = "";
    else if (mode === 1) this.lines[this.row] = line.slice(Math.min(this.col, line.length));
    else this.lines[this.row] = line.slice(0, Math.min(this.col, line.length));
  }

  /** 屏切换/清屏 = 翻页:旧屏整体进 scrollback(手机「看全输出」要历史;当前屏重开)。 */
  private clear(): void {
    let end = this.lines.length;
    while (end > 0 && !this.lines[end - 1]) end--;
    this.scrollback.push(...this.lines.slice(0, end));
    if (this.scrollback.length > SCROLL_CAP) this.scrollback.splice(0, this.scrollback.length - SCROLL_CAP);
    this.lines = new Array(this.rows).fill("");
    this.row = 0;
    this.col = 0;
  }
}
