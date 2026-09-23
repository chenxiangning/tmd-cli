/**
 * 手机实况屏 —— 迷你 VT 屏幕模型(行缓冲 + 光标)。
 * PTY 是字节流,omp 状态栏/spinner 靠「光标回退 + 行擦除」原地重绘(无清屏帧界),
 * 纯文本累加每帧堆一份 = 重复刷屏(真机两次实证:清屏帧界只治全屏重绘,治不了回退式)。
 * 模型按行覆写 → 重绘收敛为一份;线性输出(只 \n 前进)行为与累加一致。
 * 支持集:可打印字符、\n \r \t \b、CSI H/f/A/B/C/D/J/K/s/u、2J/3J、?1049 备屏、
 * OSC 剥除;SGR/其余 CSI 与显示无关忽略。桌面幕布用真 xterm,不共享此模型。
 */

/** 屏高上限:超出即上滚(丢最老行);也限定 CUP 合法行界。 */
const MAX_ROWS = 400;
/** 单行宽度上限(异常 CUP 列/超长粘贴的止损)。 */
const MAX_LINE = 2000;

/* 已闭合序列的锚定判据(与 tok 切分器同源);tail 用它识别「还没收完」的转义。 */
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
  private row = 0;
  private col = 0;
  private savedRow = 0;
  private savedCol = 0;
  /* 切分器:OSC / CSI / 单字节转义 / 控制字符各自成段,段间 = 待写文本。 */
  private readonly tok = new RegExp(
    // eslint-disable-next-line no-control-regex -- 终端控制流本就是控制字节
    "\\x1b\\][^\\x07\\x1b]*(?:\\x07|\\x1b\\\\)|\\x1b\\[[0-9:;<=>?]*[ -/]*[@-~]|\\x1b[()#][0-9A-Za-z]?|[\\x00-\\x1a\\x1c-\\x1f\\x7f]",
    "g",
  );
  /** 跨 chunk 切断的未完成转义序列(真 PTY 分块会把 CSI/OSC 拦腰切)。 */
  private pending = "";

  /** 追加一段原始 PTY 字节(含 ANSI);状态增量更新。 */
  feed(chunk: string): void {
    const data = this.pending + chunk;
    this.pending = "";
    const re = this.tok;
    re.lastIndex = 0;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(data))) {
      if (m.index > last) this.write(data.slice(last, m.index));
      last = m.index + m[0].length;
      const c = m[0];
      if (c.charCodeAt(0) === 0x1b) this.escape(c);
      else if (c === "\n") {
        /* 真终端 ONLCR:\n 同时复位列。 */
        this.row++;
        this.col = 0;
      }
      else if (c === "\r") this.col = 0;
      else if (c === "\t") this.col = Math.min(((this.col >> 3) + 1) << 3, MAX_LINE);
      else if (c === "\b") this.col = Math.max(0, this.col - 1);
      /* 其余控制字符(BEL/DEL/转义残留):纯文本视图无关。 */
    }
    if (last < data.length) this.tail(data.slice(last));
  }

  /** 尾段处理:以 ESC 起头的未完成序列进 pending,其余落屏。 */
  private tail(t: string): void {
    const esc = t.lastIndexOf("\x1b");
    if (esc >= 0 && incompleteEsc(t.slice(esc))) {
      if (esc > 0) this.write(t.slice(0, esc));
      this.pending = t.slice(esc);
      /* 永不闭合的垃圾 ESC 串:超上限当文本吐掉,防 pending 泄漏。 */
      if (this.pending.length > 4096) {
        this.write(this.pending);
        this.pending = "";
      }
      return;
    }
    this.write(t);
  }

  /** 当前屏内容(行序 = 光标序);实况视图直接渲染它。 */
  view(): string {
    let end = this.lines.length;
    while (end > 0 && !this.lines[end - 1]) end--;
    return this.lines.slice(0, end).join("\n");
  }

  private escape(c: string): void {
    if (c === "\x1b7") {
      this.savedRow = this.row;
      this.savedCol = this.col;
      return;
    }
    if (c === "\x1b8") {
      this.row = this.savedRow;
      this.col = this.savedCol;
      return;
    }
    if (c.charCodeAt(1) !== 0x5b) return; // 字符集/其余转义:忽略
    const body = c.slice(2, -1);
    const final = c.charCodeAt(c.length - 1);
    if (body.charCodeAt(0) === 0x3f /* ? */) {
      /* 备屏切换(47/1047/1049)进/出都清屏:模型不存主备双屏,切换点即新屏起点。 */
      if (/[?](47|1047|1049)[hl]$/.test(c)) this.clear();
      return;
    }
    const nums = body.match(/\d+/g)?.map(Number) ?? [];
    const p = (i: number, d: number) => (nums[i] !== undefined && nums[i] !== 0 ? nums[i] : d);
    switch (final) {
      case 0x48 /* H */:
      case 0x66 /* f */: {
        const r = p(0, 1) - 1;
        /* 越界 CUP(如 999;1H 光标停放)忽略:覆写末行比丢帧更糟。 */
        if (r >= 0 && r < MAX_ROWS) {
          this.row = r;
          this.col = Math.max(0, p(1, 1) - 1);
        }
        break;
      }
      case 0x41 /* A */:
        this.row = Math.max(0, this.row - p(0, 1));
        break;
      case 0x42 /* B */:
        this.row += p(0, 1);
        break;
      case 0x43 /* C */:
        this.col = Math.min(this.col + p(0, 1), MAX_LINE);
        break;
      case 0x44 /* D */:
        this.col = Math.max(0, this.col - p(0, 1));
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
        this.row = this.savedRow;
        this.col = this.savedCol;
        break;
      default:
        break; // SGR/模式/滚动等:纯文本视图无关
    }
  }

  private write(s: string): void {
    if (this.row >= MAX_ROWS) {
      const shift = this.row - MAX_ROWS + 1;
      this.lines.splice(0, shift);
      this.row -= shift;
      this.savedRow = Math.max(0, this.savedRow - shift);
    }
    while (this.lines.length <= this.row) this.lines.push("");
    const col = Math.min(this.col, MAX_LINE);
    const line = (this.lines[this.row] ?? "").padEnd(col, " ");
    this.lines[this.row] = (line.slice(0, col) + s).slice(0, MAX_LINE);
    this.col = Math.min(col + s.length, MAX_LINE);
  }

  private eraseLine(mode: number): void {
    while (this.lines.length <= this.row) this.lines.push("");
    const line = this.lines[this.row] ?? "";
    if (mode === 2 || mode === 3) this.lines[this.row] = "";
    else if (mode === 1) this.lines[this.row] = line.slice(Math.min(this.col, line.length));
    else this.lines[this.row] = line.slice(0, Math.min(this.col, line.length));
  }

  private clear(): void {
    this.lines = [];
    this.row = 0;
    this.col = 0;
  }
}
