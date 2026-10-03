/**
 * 手机实况屏 —— 迷你 VT 视口模型(固定 H×W 行缓冲 + 光标 + 触底上滚)。
 * omp 全程 alt-screen + 绝对 CUP 定位重绘(实证:页脚钉第 31/33 行,视口高约 34),
 * 无滚动区/插删行。上一版无固定视口:正文一超行,CUP(31) 就落回文档中段盖正文、
 * 页脚散落多行 = 重复(真机三次实证)。正解 = 忠实终端:固定高度,LF 到底上滚,
 * 按列换行(DECAWM 可关),CUP 夹在视口内 → 重绘天然收敛为一份。
 * 滚出视口的行进 scrollback(上限 SCROLL_CAP 行),view() 取全量历史,
 * 手机实况区因此能向上滚动看旧输出。
 * 支持集:可打印、\n \r \t \b、ESC 7/8/M/D/E、CSI H/f/A/B/C/D/E/G/J/K/M/s/u、2J/3J(真擦除,
 * 实证:omp 每次 SIGWINCH 都走 2J 重绘;历史保全职责只归备屏切换)、模式
 * ?7h/l(换行)?1049h/l(备屏清屏);SGR/其余忽略。桌面幕布用真 xterm,不共享。
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
  /* ESC+中间字节(0x20-0x2F,含 ()#%)结尾 = 等终字节,跨 chunk 不落屏。 */
  return /^\x1b[ -/]+$/.test(t);
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
  /* 切分器:OSC / CSI / 单字节转义 / 控制字符各自成段,段间 = 待写文本。单字节类
   *  含 =<>(DECKPAM/PNM)与中间字节族(\x1b%G 等)—— 缺类会当字面落屏,其余
   *  未知 ESC 序列按终端惯例吞掉不打印。 */
  private readonly tok = new RegExp(
    // eslint-disable-next-line no-control-regex -- 终端控制流本就是控制字节
    "\\x1b\\][^\\x07\\x1b]*(?:\\x07|\\x1b\\\\)|\\x1b[PX^_][\\s\\S]*?\\x1b\\\\|\\x1b\\[[0-9:;<=>?]*[ -/]*[@-~]|\\x1b[()#][0-9A-Za-z]?|\\x1b[ -/]+[0-9A-Za-z=<>]|\\x1b[0-9A-Za-z=<>]|[\\x00-\\x1a\\x1c-\\x1f\\x7f]",
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
    /* DCS/SOS/PM/APC 预扫:未收口族头切进 pending(否则单字节转义分支先吃掉 \x1bP,族体落屏 —— opentui 探测串实证);永不收口超长垃圾当文本吐掉。 */
    const open = /\x1b[PX^_](?:(?!\x1b\\)[\s\S])*$/.exec(data);
    const body = open && open[0].length <= 4096 ? data.slice(0, open.index) : data;
    if (body !== data) this.pending = open![0];
    const re = this.tok;
    re.lastIndex = 0;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body))) {
      if (m.index > last) this.print(body.slice(last, m.index));
      last = m.index + m[0].length;
      const c = m[0];
      if (c.charCodeAt(0) === 0x1b) this.escape(c);
      else if (c === "\n") this.lineFeed();
      else if (c === "\r") this.col = 0;
      else if (c === "\t") this.col = Math.min(((this.col >> 3) + 1) << 3, this.cols - 1);
      else if (c === "\b") this.col = Math.max(0, this.col - 1);
      /* 其余控制字符(BEL/DEL/转义残留):纯文本视口无关。 */
    }
    if (last < body.length) this.tail(body.slice(last));
  }

  /** 全量内容 = scrollback + 当前视口(去尾部空行);alt-screen 切换会清 scrollback(见 clear)。 */
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
        /* DECRC 恢复按当前几何夹持(同 CSI u 分支):缩屏后存档位界外会把
         * lines 撑超视口行数。 */
        this.row = Math.min(this.savedRow, this.rows - 1);
        this.col = Math.min(this.savedCol, this.cols - 1);
      }
      return;
    }
    if (c === "\x1bM") { this.reverseLineFeed(1); return; } /* RI:与 CSI M 同路 */
    if (c === "\x1bD") { const col = this.col; this.lineFeed(); this.col = col; return; } /* IND:行进不归列 */
    if (c === "\x1bE") { this.lineFeed(); return; } /* NEL:CR+LF */
    if (c.charCodeAt(1) !== 0x5b) return; // 字符集/其余转义:忽略
    const body = c.slice(2, -1);
    const final = c.charCodeAt(c.length - 1);
    if (body.charCodeAt(0) === 0x3f /* ? */) {
      /* 备屏切换进/出都清屏:模型不存主备双屏,切换点即新屏起点。 */
      if (/\?(47|1047|1049)[hl]$/.test(c)) this.clear();
      else if (/\?7h$/.test(c)) this.wrap = true;
      else if (/\?7l$/.test(c)) this.wrap = false;
      /* ?7l 不清 pending wrap(col 可悬在 cols):xterm 实测满行+?7l+?7h 后
       * 打印仍按待换行走,提前夹持会把行尾字符覆写掉(2026-10-03 二轮复查,
       * xterm.js 基准);?7l 期间打印由 print 的写位夹持停在末列,col 不动。 */
      /* 其余 ? 模式(光标/批处理/鼠标):纯文本视口无关。 */
      return;
    }
    /* 按位取参:空位/0 用默认(\x1b[;5H 的前导空位不可折叠,冒号子参取首段)。 */
    const parts = body.split(";").map((s) => { const n = parseInt(s, 10); return n > 0 ? n : 0; });
    const p = (i: number, d: number) => parts[i] || d;
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
      case 0x45 /* E CNL:下移 n 行归列首 */:
        this.row = Math.min(this.rows - 1, this.row + p(0, 1));
        if (final === 0x45) this.col = 0;
        break;
      case 0x43 /* C */:
        this.col = Math.min(this.cols - 1, this.col + p(0, 1));
        break;
      case 0x44 /* D */:
      case 0x47 /* G */:
        /* G(CHA)夹持列:?7l 幽灵列的另一入口(与 CUP 同律,2026-10-03 二轮)。 */
        this.col =
          final === 0x47
            ? Math.min(this.cols - 1, Math.max(0, p(0, 1) - 1))
            : Math.max(0, this.col - p(0, 1));
        break;
      case 0x4d /* M */:
        this.reverseLineFeed(p(0, 1));
        break;
      case 0x4a /* J */:
        this.eraseDisplay(parts[0] || 0);
        break;
      case 0x4b /* K */:
        this.eraseLine(parts[0] || 0);
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
      /* 写位夹持:?7l(DECAWM 关)下 xterm 光标停在末列原地覆写,不进界外
       * 幽灵格(界外字符会原样进 view(),比真终端多显示一列)。只夹写位不
       * 动 col:pending(col==cols,可能从 wrap 开期带入)原样保留,?7h 后
       * 恢复按待换行走(xterm 实测语义;2026-10-03 二轮复查)。 */
      const at = this.wrap ? Math.min(this.col, MAX_LINE) : Math.min(this.col, this.cols - 1);
      this.lines[this.row] =
        line.slice(0, at).padEnd(at, " ") + ch + line.slice(at + 1);
      /* 光标推进:wrap 开允许到 cols 挂起待换行(下一字符先 lineFeed 再落笔);
       * wrap 关钉末列(col 本身可能停在 cols = 带 pending 的停泊位,写位已夹)。 */
      if (this.wrap ? this.col < this.cols : this.col < this.cols - 1) this.col++;
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
    /* 上滚到顶保守仅夹行;列不动(xterm reverseIndex 同律,2026-10-04 复审)。 */
    this.row = Math.max(0, this.row - n);
  }

  private eraseLine(mode: number): void {
    const line = this.lines[this.row] ?? "";
    if (mode === 2 || mode === 3) this.lines[this.row] = "";
    else if (mode === 1) {
      /* EL1 = 行首到光标含光标格擦除(VT510 inclusive;旧实现保留光标格
       * 少擦一格);前段补空保列位(模型无格坐标,2026-10-03 二轮评审)。 */
      const at = Math.min(this.col + 1, line.length);
      this.lines[this.row] = " ".repeat(at) + line.slice(at);
    } else this.lines[this.row] = line.slice(0, Math.min(this.col, line.length));
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

  /** ED(擦显示):真擦除,不翻页 —— 2J 翻页会把整屏复制进 scrollback,
   *  SIGWINCH 后的全帧重绘(omp 实证:2J + CUP)就变成头信息出现两份。
   *  擦除的内容由紧随的全帧重绘原样补回,无信息损失;2J 不动光标(xterm 语义,
   *  应用自会 [H)。3J = 清 saved lines(scrollback),视口不动。 */
  private eraseDisplay(mode: number): void {
    if (mode === 2) {
      this.lines = new Array(this.rows).fill("");
      return;
    }
    if (mode === 3) {
      this.scrollback = [];
      return;
    }
    const line = this.lines[this.row] ?? "";
    if (mode === 0) {
      this.lines[this.row] = line.slice(0, Math.min(this.col, line.length));
      for (let i = this.row + 1; i < this.lines.length; i++) this.lines[i] = "";
    } else {
      /* ED1 = 屏首到光标含光标格擦除(VT510 inclusive;同 EL1 修正)。 */
      const at = Math.min(this.col + 1, line.length);
      this.lines[this.row] = " ".repeat(at) + line.slice(at);
      for (let i = 0; i < this.row; i++) this.lines[i] = "";
    }
  }

  /** 原地改几何(尺寸轮询路径):溢出行进 scrollback、变高补空行、光标夹持。
   *  不重放字节 —— 重放快照存在在途 chunk 双喂窗口(头信息重复的第二来源)。
   *  缩列分两族:全帧重绘型(omp)WINCH 后按新几何收敛;差分重绘型(opentui)
   *  只补新行,视口旧行按屏外格截断(见函数内注释);scrollback 一律原宽归 CSS。 */
  resize(cols: number, rows: number): void {
    const nc = Math.max(1, Math.min(cols || DEFAULT_COLS, MAX_LINE));
    if (nc < this.cols) {
      /* 差分重绘型 TUI(opentui 实证:WINCH 只补新行,永不 ED/EL)缩列按「屏外格不可见」截视口旧行,否则 pre-wrap 折行整屏错位;scrollback 不截,历史归 CSS。 */
      this.lines = this.lines.map((l) => (l && l.length > nc ? l.slice(0, nc) : l));
    }
    this.cols = nc;
    const nr = Math.max(1, Math.min(rows || DEFAULT_ROWS, 500));
    while (this.lines.length > nr) this.scrollback.push(this.lines.shift() ?? "");
    if (this.scrollback.length > SCROLL_CAP) this.scrollback.splice(0, this.scrollback.length - SCROLL_CAP);
    while (this.lines.length < nr) this.lines.push("");
    this.rows = nr;
    if (this.row >= nr) this.row = nr - 1;
    /* 列不夹持(2026-10-03 二轮复查):wrap 开的 pending(col==cols)须原样
     * 保留(夹掉 = 下一字符覆写行尾旧字符);wrap 关的界外 col 由 print 的
     * 写位夹持兜住(停末列覆写),CUP/G 等绝对定位自身夹持。 */
  }
}
