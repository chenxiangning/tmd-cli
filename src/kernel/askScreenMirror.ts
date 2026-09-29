/**
 * 后台会话的屏幕态镜像 —— Ask 屏幕通道对未挂幕布会话的补盲(askWatch v3.2)。
 *
 * 屏幕态通道(askWatchCore.onScreenSample)原只认挂载幕布(TerminalView askProbe)
 * 的采样:tab 未打开/已摘除的前后台会话无人采样。而 omp 等 TUI 的 Ask 面板以整帧
 * 光标寻址重绘:面板标记埋在帧中部、帧尾是状态栏,字节通道「逐 chunk 末尾页脚窗
 * 评估」结构性漏检(2026-09-11 真实日志回放实证:≥4KB 批粒度下 2.7MB 含多个 live
 * 面板零命中),后台等待不可见,只能开 tab 兜出。
 *
 * v3.1(2026-09-11)首版镜像固定 80×24 只采底部 8 行,两处几何失真被 2026-09-29
 * 真实日志复现证伪:① Rust 侧 spawn 默认是 120×32(pty.rs default_cols/rows),
 * 80×24 从未与真实 PTY 一致;② 前台探针 2026-09-27 已因「8 行够不着高面板」加深
 * 到 24 行,镜像未同步 —— 长选项面板的标记实测落在距屏底 14-38 行,旧参数全几何
 * 零命中;且前台 fit 过的会话回后台后,重绘帧按旧栅格解释整帧错位,镜像的假「缺席」
 * 把字节通道已置位的等待也自愈摘掉(改窗口大小徽章即消失的症状)。v3.2 镜像栅格
 * 对齐真实 PTY:懒建时用 resizeSession 中继过的最新尺寸,否则拉 session_size
 * (webview 重载后唯一幸存的尺寸真源),再回落 120×32;采样改全屏 —— scrollback=0
 * 的缓冲就是物理屏,屏上有标记即可观测,滚出即消失无历史假阳性,瞬态闪帧仍由
 * ASK_CONFIRM_MS 持续在场防抖过滤。
 *
 * 本件给每条活 CLI 会话养一个 headless xterm 镜像:appendOutput 的同流字节同步
 * 写入,250ms 采样全屏喂 onScreenSample;幕布已挂载的会话让位真实采样
 * (getTerminalHandle 判定,互斥防双源打架)。readopt 后磁盘日志尾回放补底
 * (backfill;先等几何就绪再回放,防错栅格解释整帧;磁盘字节与幕布回放同源,
 * 严禁经 appendOutput,diskReplay 红线)。补底与实时字节的重叠区容忍:面板帧是
 * 绝对寻址重绘,后到帧覆盖先到态。
 */

import { Terminal } from "@xterm/xterm";
import { getTerminalHandle } from "./terminalHandles";

/** 默认栅格:与 Rust 侧 PTY spawn 默认一致(pty.rs default_cols/default_rows);尺寸未知时的兜底。 */
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 32;

/** 采样节拍:置位延迟 ≈ ASK_CONFIRM_MS + 采样间隔(250ms 下 1.2-1.45s;旧 1Hz 实测 2-3s,
 *  用户体感「慢」)。可见性误报由持续在场防抖兜底,采样密度只影响延迟不影响正确性。 */
const SAMPLE_INTERVAL_MS = 250;

interface MirrorEntry {
  term: Terminal;
  /** 几何就绪信号(session_size 拉取定稿):backfill 须等它再回放整帧,错栅格解释即垃圾屏。 */
  ready: Promise<void>;
  /** 几何代数:resize 中继每次 +1;在途拉取回包只在代数未变时生效(防旧尺寸盖新中继)。 */
  gen: number;
}

/** 计时器句柄:webview 运行时是 number,Node 测试环境是 Timeout;仅内部持有(同 askWatchCore)。 */
type TimerHandle = ReturnType<typeof setInterval>;

export class AskScreenMirror {
  private readonly entries = new Map<string, MirrorEntry>();
  /** 幕布中继尺寸(会话尚无镜像时暂存,懒建即用):后台会话的 resize 只可能来自
   *  它先前挂幕布的残留时序,先于首字节到达。 */
  private readonly pendingSize = new Map<string, [number, number]>();
  private timer: TimerHandle | null = null;

  constructor(
    private readonly onSample: (sessionId: string, screenText: string) => void,
    /** 真实 PTY 尺寸拉取(host 注入 ipc.sessionSize;测试缺省跳过)。null = 未知,守默认栅格。 */
    private readonly querySize?: (sessionId: string) => Promise<[number, number] | null>,
  ) {}

  /** 实时字节入站(HostWatches.appendOutput 同流):镜像保持屏幕现势。 */
  feed(sessionId: string, text: string): void {
    this.entry(sessionId).term.write(text);
  }

  /** 幕布尺寸中继(host.resizeSession 唯一入口):前台 fit 过的会话回后台后,后续
   *  SIGWINCH 整帧重绘按新栅格解释,镜像不再产生假缺席。 */
  resize(sessionId: string, cols: number, rows: number): void {
    const entry = this.entries.get(sessionId);
    if (entry) {
      entry.gen += 1;
      entry.term.resize(cols, rows);
    } else {
      this.pendingSize.set(sessionId, [cols, rows]);
    }
  }

  /** 磁盘日志尾回放补底(readopt 后逐会话调用,日志尾由接管方单取分用,见
   *  hostSessionServices.readopt):重建重载前的屏幕现势,旧挂起的面板无须等下一
   *  次整帧重绘即可见。先等几何就绪再写。 */
  async backfill(sessionId: string, text: string): Promise<void> {
    if (!text) return; /* 无日志尾不养空镜像 */
    const entry = this.entry(sessionId);
    await entry.ready;
    if (this.entries.get(sessionId) !== entry) return; /* 回放途中会话移除 */
    entry.term.write(text);
  }

  /** 会话移除:镜像随 PTY 消亡,采样计时器空闲即停。pendingSize 无条件清 ——
      未 feed 过的会话(SSH/中继先于首字节)无 entry,早退会泄漏暂存尺寸。 */
  remove(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    this.pendingSize.delete(sessionId);
    if (!entry) return;
    this.entries.delete(sessionId);
    entry.term.dispose();
    if (this.entries.size === 0) this.stopTimer();
  }

  /** 测试专用:全态归零(与 resetStatusTimerForTest 同因)。 */
  resetForTest(): void {
    for (const entry of this.entries.values()) entry.term.dispose();
    this.entries.clear();
    this.pendingSize.clear();
    this.stopTimer();
  }

  private entry(sessionId: string): MirrorEntry {
    let entry = this.entries.get(sessionId);
    if (entry) return entry;
    const [cols, rows] = this.pendingSize.get(sessionId) ?? [DEFAULT_COLS, DEFAULT_ROWS];
    this.pendingSize.delete(sessionId);
    entry = { term: new Terminal({ cols, rows, scrollback: 0 }), ready: Promise.resolve(), gen: 0 };
    this.entries.set(sessionId, entry);
    this.startTimer();
    if (this.querySize) {
      const { promise, resolve } = Promise.withResolvers<void>();
      entry.ready = promise;
      const gen = entry.gen;
      void (async () => {
        try {
          const size = await this.querySize!(sessionId);
          if (size && this.entries.get(sessionId) === entry && entry.gen === gen) {
            entry.term.resize(size[0], size[1]);
          }
        } catch {
          /* 拉取不可用(测试桩/传输未连):守当前栅格 */
        }
        resolve();
      })();
    }
    return entry;
  }

  private startTimer(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.sampleAll(), SAMPLE_INTERVAL_MS);
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** 采样:只采无幕布会话(挂载幕布由 TerminalView askProbe 负责)。 */
  private sampleAll(): void {
    for (const [sessionId, entry] of this.entries) {
      if (getTerminalHandle(sessionId)) continue;
      this.onSample(sessionId, screenTextOf(entry.term));
    }
  }
}

/** 全屏文本(非 viewport):scrollback=0 缓冲即物理屏;每行去尾空白 + "\n",与
 *  TerminalView askProbe 逐字符同式;屏底空行裁除(空白不影响标记判定,只产噪音)。 */
function screenTextOf(term: Terminal): string {
  const buf = term.buffer.active;
  const bottom = Math.min(buf.length, buf.baseY + term.rows);
  const lines: string[] = [];
  for (let row = buf.baseY; row < bottom; row++) {
    lines.push(buf.getLine(row)?.translateToString(true) ?? "");
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((l) => l + "\n").join("");
}
