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
  private hasMore = false;

  constructor(
    private readonly sessionId: string,
    private readonly inputGate: ReplayInputGate,
    /** hasMore/loading 变化回喂(TerminalView 的 setHasMore/setLoadingHistory)。 */
    private readonly onState: (hasMore: boolean, loading: boolean) => void,
  ) {}

  /** 会话日志还有更早未加载的输出(锚点跳转翻页判据)。 */
  hasMoreHistory(): boolean {
    return this.earliestByte > 0;
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

  /** 往前翻一页:从会话日志读更早的原始输出,RIS 重置后连同现有内容整段重写。 */
  async loadEarlier(term: Terminal): Promise<void> {
    if (this.loading) return;
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
        return;
      }
      this.prefix.unshift(page.text); // 更早的页排前面
      this.earliestByte = page.startOffset;
      this.hasMore = page.hasMore;
      this.emit();
      /* \x1bc(RIS)整屏重置后与历史一并入队:与实时写共用 xterm 同一写队列,无竞态;
         期间到达的实时字节已含在 getOutputBuffer 快照里,之后的排在本次写之后。
         顺序逐页 write,不做 join 大字符串 —— 跨页 join 是 O(N²) 字符工作量,
         xterm 自带写队列,分次写入语义与一次性大 write 等价。 */
      /* 整段重写 = 历史查询(DSR/DA/OSC 颜色)被重新应答 —— 上闸,
         末段 write 回调释放;异常路径由 finally 兜底,不成对会永久锁死输入 */
      this.inputGate.arm();
      term.write("\x1bc");
      for (const prefix of this.prefix) term.write(prefix);
      /* 末段 write 回调内 resolve:调用方(锚点跳转翻页循环)await 拿到的是
         buffer 已含新历史的时刻 */
      await new Promise<void>((resolve) =>
        term.write(host.getOutputBuffer(this.sessionId), () => {
          this.inputGate.release();
          term.scrollToTop();
          resolve();
        }),
      );
    } finally {
      this.inputGate.release(); // 异常兜底:正常路径已释放,计数钳位到 0
      this.loading = false;
      this.emit();
    }
  }
}
