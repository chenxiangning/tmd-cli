/**
 * 幕布历史翻页器 —— 自 TerminalView.tsx 拆出(文件规模铁则收紧至 300 行)。
 * 承担:翻页锚点(幕布内容起点的绝对字节偏移)、历史页前缀缓存、
 * 「加载更早的输出」整段重写(RIS + 前缀页 + 输出缓冲快照)。
 * 重入闸/输入闸语义与拆前一致;hasMore/loading 变化经 onState 回喂 React state。
 */

import type { Terminal } from "@xterm/xterm";
import { ipc } from "@kernel/ipc";
import { host } from "@kernel/host";
import type { ReplayInputGate } from "@kernel/terminalInputGate";

/** 每次翻页向日志读取的历史字节数(512KB)。 */
const HISTORY_PAGE_BYTES = 512 * 1024;



export class TerminalHistoryPager {
  /** 翻页锚点:当前幕布内容起点在全量输出中的绝对字节偏移。 */
  private earliestByte = 0;
  /** 已翻出的历史页(从旧到新)。 */
  private prefix: string[] = [];
  /** 重入闸必须是同步属性:state 闸要等 React 重渲染才翻转,
      而锚点跳转的翻页循环在微任务里续延 —— state 闸会让第 2 页起确定性停摆。 */
  private loading = false;
  /** 在飞页 Promise:并发定位共享同一页,完成后各自重扫,不假 miss。 */
  private inFlight: Promise<unknown> | null = null;
  private hasMore = false;
  /** 历史窗口态(⌘F 深跳后):真 = 幕布主体是日志窗口而非活缓冲,UI 出「回到最新」。 */
  private jumpWindow = false;

  constructor(
    private readonly sessionId: string,
    private readonly inputGate: ReplayInputGate,
    /** hasMore/loading 变化回喂(TerminalView 的 setHasMore/setLoadingHistory)。 */
    private readonly onState: (hasMore: boolean, loading: boolean) => void,
  ) {}

  /** 会话日志还有更早未加载的输出(锚点跳转翻页判据)。 */
  hasMoreHistory(): boolean {
    return this.hasMore;
  }

  /** 当前是否身处历史窗口(performJump 置位,resetToLatest 复位)。 */
  isInJumpWindow(): boolean {
    return this.jumpWindow;
  }

  /** 等在飞页重写与 scrollToTop 完成;定位不得抢在旧页落位前执行。 */
  async settled(): Promise<void> {
    await this.inFlight?.catch(() => undefined);
  }

  private emit(): void {
    this.onState(this.hasMore, this.loading);
  }

  /* 翻页锚点初始化:缓冲起点绝对偏移 = 日志末尾 - 当前缓冲字节数。
     缓冲是字节流的精确后缀(sliceStreamTail 保证边界),故用字节数反推。 */
  async init(): Promise<void> {
    const end = await ipc.sessionLogSize(this.sessionId);
    /* 字节数由 host 随 append 增量维护,直读即可,不再全量编码 */
    const currentBytes = host.getOutputBufferBytes(this.sessionId);
    this.earliestByte = Math.max(0, end - currentBytes);
    this.hasMore = this.earliestByte > 0;
    this.emit();
  }

  /** 往前翻一页;返回是否真推进。并发调用共享在飞页。 */
  loadEarlier(term: Terminal): Promise<boolean> {
    if (this.inFlight) return this.inFlight as Promise<boolean>;
    const run = this.performLoadEarlier(term);
    this.inFlight = run;
    return run;
  }

  /** 窗口化跳转(⌘F 磁盘命中定位,0.4.5):读 offset 起的一窗历史重写幕布 ——
   *  不逐页回放(深跳 64MB 逐页重写 = O(n²) 字节写入,不可行);窗口尾与
   *  当前缓冲之间插入一行 dim 间隙标记如实声明跳过段;锚点改指窗口起点,
   *  「加载更早」从窗口起点继续向前翻,活缓冲照常追尾。占用在飞槽(与
   *  翻页互斥,迟到者共享同一跳转)。 */
  jumpToByte(term: Terminal, offset: number, gapLabel: string): Promise<boolean> {
    if (this.inFlight) return this.inFlight as Promise<boolean>;
    const run = this.performJump(term, offset, gapLabel);
    this.inFlight = run;
    return run;
  }

  private async performJump(term: Terminal, offset: number, gapLabel: string): Promise<boolean> {
    this.loading = true;
    this.emit();
    try {
      /* 窗尾三重钳制:页字节预算 × 日志尾 × 当前缓冲起点 —— 越过 earliestByte
       * 会在缓冲快照里再写一遍同一区段(双喂重复渲染,2026-10-26 复审);
       * 命中落在缓冲区内(>= earliestByte)返回空页不跳,由缓冲搜索负责。 */
      const before = Math.min(
        offset + HISTORY_PAGE_BYTES,
        this.earliestByte,
        await ipc.sessionLogSize(this.sessionId),
      );
      const page = await ipc.sessionHistoryPage(this.sessionId, before, HISTORY_PAGE_BYTES);
      if (!page.text) return false;
      this.prefix = [page.text];
      this.earliestByte = page.startOffset;
      this.hasMore = page.hasMore;
      this.jumpWindow = true;
      this.emit();
      this.inputGate.arm();
      term.write("\x1bc");
      term.write(page.text);
      term.write(`\x1b[2m${gapLabel}\x1b[0m\r\n`);
      const { promise, resolve } = Promise.withResolvers<void>();
      term.write(host.getOutputBuffer(this.sessionId), () => {
        this.inputGate.release();
        term.scrollToTop();
        resolve();
      });
      await promise;
      return true;
    } finally {
      this.inputGate.release();
      this.loading = false;
      this.inFlight = null;
      this.emit();
    }
  }

  private async performLoadEarlier(term: Terminal): Promise<boolean> {
    this.loading = true;
    this.emit();
    try {
      const page = await ipc.sessionHistoryPage(
        this.sessionId,
        this.earliestByte,
        HISTORY_PAGE_BYTES,
      );
      if (!page.text) {
        this.hasMore = false;
        this.emit();
        return false;
      }
      this.prefix.unshift(page.text); // 更早的页排前面
      this.earliestByte = page.startOffset;
      this.hasMore = page.hasMore;
      this.emit();
      /* RIS 与历史/实时快照共用 xterm 写队列;末段回调时 buffer 已可搜索。 */
      this.inputGate.arm();
      term.write("\x1bc");
      for (const prefix of this.prefix) term.write(prefix);
      const { promise, resolve } = Promise.withResolvers<void>();
      term.write(host.getOutputBuffer(this.sessionId), () => {
        this.inputGate.release();
        term.scrollToTop();
        resolve();
      });
      await promise;
      return true;
    } finally {
      this.inputGate.release(); // 异常兜底:正常路径已释放,计数钳位到 0
      this.loading = false;
      this.inFlight = null;
      this.emit();
    }
  }

  /** 退出历史窗口回到活流视图:RIS 重写为纯输出缓冲,锚点回初始化值,贴底。
   *  占用 inFlight 槽(与翻页/跳转互斥);emit 驱动 UI 复位。 */
  resetToLatest(term: Terminal): Promise<void> {
    if (this.inFlight) return this.inFlight.then(() => this.resetToLatest(term));
    const run = this.performResetLatest(term);
    this.inFlight = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async performResetLatest(term: Terminal): Promise<void> {
    this.loading = true;
    this.emit();
    try {
      const end = await ipc.sessionLogSize(this.sessionId);
      const currentBytes = host.getOutputBufferBytes(this.sessionId);
      this.prefix = [];
      this.earliestByte = Math.max(0, end - currentBytes);
      this.hasMore = this.earliestByte > 0;
      this.jumpWindow = false;
      this.inputGate.arm();
      term.write("\x1bc");
      const { promise, resolve } = Promise.withResolvers<void>();
      term.write(host.getOutputBuffer(this.sessionId), () => {
        this.inputGate.release();
        term.scrollToBottom();
        resolve();
      });
      await promise;
    } finally {
      this.inputGate.release();
      this.loading = false;
      this.inFlight = null;
      this.emit();
    }
  }
}
