/** 滚出视口行的串缓存(D2-6,自 liveText 拆出:300 行铁则)—— 流式 100ms
 *  合帧不再每次全量 [scrollback+lines].join,长会话回看时秒级 ~10 次数 MB
 *  分配消失;join 只落在有界视口行。行数判空串行(空行也是一行)。 */
const SCROLL_CAP = 2000;

export class ScrollbackBuffer {
  text = "";
  rows = 0;

  /** 追加滚出行 + 行数上限滚动(超限从头丢整行)。 */
  push(gone: string[]): void {
    if (gone.length === 0) return;
    const joined = gone.join("\n");
    this.text = this.rows > 0 ? `${this.text}\n${joined}` : joined;
    this.rows += gone.length;
    const drop = this.rows - SCROLL_CAP;
    if (drop > 0) {
      let cut = -1;
      for (let i = 0; i < drop; i++) cut = this.text.indexOf("\n", cut + 1);
      this.text = cut >= 0 ? this.text.slice(cut + 1) : "";
      this.rows = SCROLL_CAP;
    }
  }

  clear(): void {
    this.text = "";
    this.rows = 0;
  }
}
