/**
 * 后台会话的屏幕态镜像 —— Ask 屏幕通道对未挂幕布会话的补盲(askWatch v3.1)。
 *
 * 屏幕态通道(askWatchCore.onScreenSample)原只认挂载幕布(TerminalView askProbe)
 * 的 1Hz 采样:tab 未打开/已摘除的后台会话无人采样。而 omp 等 TUI 的 Ask 面板
 * 以整帧光标寻址重绘:面板标记埋在帧中部、帧尾是状态栏,字节通道「逐 chunk
 * 末尾页脚窗评估」结构性漏检(2026-09-11 真实日志回放实证:≥4KB 批粒度下
 * 2.7MB 含多个 live 面板零命中;细粒度偶发的命中也因页脚无字面量被守望自愈
 * 摘除),后台等待永远不可见,只能开 tab 兜出(用户实测症状)。
 *
 * 本件给每条活 CLI 会话养一个 headless xterm 镜像:appendOutput 的同流字节
 * 同步写入,1Hz 采样底部 8 行喂 onScreenSample,与 TerminalView askProbe 同口径;
 * 幕布已挂载的会话让位真实采样(getTerminalHandle 判定,互斥防双源打架),
 * 镜像只补后台盲区。不接 resizeSession:标记贴着状态栏/提示行上方,80/120/200
 * 列镜像实测都落在底部 8 行窗内,尺寸联动属过度设计。
 *
 * 镜像无历史的场景(webview 重载后新建):只反映新字节,重载前已挂起的面板
 * 要等下一次整帧重绘才可见 —— readopt 后用磁盘日志尾回放补底(backfillFromDisk;
 * 磁盘字节与幕布回放同源,严禁经 appendOutput,diskReplay 红线)。补底与实时
 * 字节的重叠区容忍:面板帧是绝对寻址重绘,后到帧覆盖先到态。
 */

import { Terminal } from "@xterm/xterm";
import { ipc } from "./ipc";
import { getTerminalHandle } from "./terminalHandles";

/** 采样行数:与 TerminalView askProbe 同口径(面板标记落面板尾部,底部 8 行覆盖)。 */
const SAMPLE_ROWS = 8;

/** 补底窗量:覆盖最后一帧整帧重绘 + 后续增量(pi-tui 单帧可达 9KB,256KB 富余)。 */
const BACKFILL_BYTES = 256 * 1024;

/** 默认栅格:与 Rust 侧 PTY spawn 默认一致;真实尺寸未知时的兜底。 */
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

interface MirrorEntry {
  term: Terminal;
}

/** 计时器句柄:webview 运行时是 number,Node 测试环境是 Timeout;仅内部持有(同 askWatchCore)。 */
type TimerHandle = ReturnType<typeof setInterval>;
export class AskScreenMirror {
  private readonly entries = new Map<string, MirrorEntry>();
  private timer: TimerHandle | null = null;

  constructor(private readonly onSample: (sessionId: string, screenText: string) => void) {}

  /** 实时字节入站(HostWatches.appendOutput 同流):镜像保持屏幕现势。 */
  feed(sessionId: string, text: string): void {
    this.entry(sessionId).term.write(text);
  }

  /**
   * 磁盘日志尾回放补底(readopt 后逐会话调用):重建重载前的屏幕现势,
   * 旧挂起面板无须等下一次整帧重绘即可见。恢复是增强:失败仅告警不抛出,
   * 不得拖垮接管流程(与 bootAskRestore 同纪律)。
   */
  async backfillFromDisk(sessionId: string): Promise<void> {
    try {
      const end = await ipc.sessionLogSize(sessionId);
      if (!end) return; /* 无日志(含尚未落盘的新会话)= 无现势可补 */
      const page = await ipc.sessionHistoryPage(sessionId, end, BACKFILL_BYTES);
      if (page.text) this.feed(sessionId, page.text);
    } catch (e) {
      console.warn("屏幕镜像补底失败(不影响会话):", sessionId, e);
    }
  }

  /** 会话移除:镜像随 PTY 消亡,采样计时器空闲即停。 */
  remove(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    this.entries.delete(sessionId);
    entry.term.dispose();
    if (this.entries.size === 0) this.stopTimer();
  }

  /** 测试专用:全态归零(与 resetStatusTimerForTest 同因)。 */
  resetForTest(): void {
    for (const entry of this.entries.values()) entry.term.dispose();
    this.entries.clear();
    this.stopTimer();
  }

  private entry(sessionId: string): MirrorEntry {
    let entry = this.entries.get(sessionId);
    if (entry) return entry;
    entry = { term: new Terminal({ cols: DEFAULT_COLS, rows: DEFAULT_ROWS, scrollback: 0 }) };
    this.entries.set(sessionId, entry);
    this.startTimer();
    return entry;
  }

  private startTimer(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.sampleAll(), 1000);
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** 1Hz 采样:只采无幕布会话(挂载幕布由 TerminalView askProbe 负责)。 */
  private sampleAll(): void {
    for (const [sessionId, entry] of this.entries) {
      if (getTerminalHandle(sessionId)) continue;
      this.onSample(sessionId, screenTailOf(entry.term));
    }
  }
}

/** 底部 8 行文本(非 viewport):与 TerminalView askProbe 逐字符同式,用户上翻不影响判定。 */
function screenTailOf(term: Terminal): string {
  const buf = term.buffer.active;
  const bottom = Math.min(buf.length, buf.baseY + term.rows);
  let screenTail = "";
  for (let row = Math.max(0, bottom - SAMPLE_ROWS); row < bottom; row++) {
    screenTail += (buf.getLine(row)?.translateToString(true) ?? "") + "\n";
  }
  return screenTail;
}
