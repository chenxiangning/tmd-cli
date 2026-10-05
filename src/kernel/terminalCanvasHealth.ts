/**
 * 幕布健康接线 —— TerminalView 的两个巡检与卸载补种(文件规模铁则拆出;
 * 判据纯函数在 canvasStall.ts,镜像本体在 askScreenMirror.ts)。
 *
 * - startAskScreenProbe:Ask 屏幕态采样(askWatch v3)的挂幕布侧探针;
 * - startCanvasStallProbe:幕布数据链停滞探针(2026-10-04 十一轮)——
 *   「PTY 在流而幕布不吃字节」是既有守望(rAF 探针/壳侧心跳)的盲区,
 *   rAF 活着 = 阶梯不击打,幕布停在旧帧直到人手刷新;本探针补检出线,
 *   自愈 = canvasGen 自增(重订阅 + 缓冲回放),与渲染死亡阶梯互斥分工;
 * - buildReseedScreen:幕布卸载时的终态屏幕(镜像补种载荷,feed 互斥收尾)。
 */
import type { Terminal } from "@xterm/xterm";
import { host } from "@kernel/host";
import { nativeRafGapMs } from "@kernel/rafFallback";
import { shouldRebuildCanvas } from "@kernel/canvasStall";

/** Ask 屏幕采样节拍:置位延迟 ≈ ASK_CONFIRM_MS + 采样间隔(旧 1Hz 实测 2-3s,用户体感慢)。 */
const ASK_PROBE_MS = 250;
/** 停滞巡检节拍(判据静默窗 6s,2s 巡检的发现延迟 ≤ 2s)。 */
const STALL_PROBE_MS = 2_000;

/**
 * Ask 屏幕态采样(askWatch v3):omp 等待期间 spinner 以光标寻址持续重绘,
 * 面板标记一旦流出字节尾窗永不复现(实测 3h 挂起面板后流 7.4MB)——字节流
 * 检测对此原理性无解,但屏幕上标记始终在:贴底时采整个视口喂检测器(与后台
 * 镜像全屏同口径;omp 大窗口面板在中上部、底部留空,固定底窗 8→24 行两代
 * 都被实测证伪——2026-09-29 大窗实测标记距屏底 30-38 行)。
 * 贴底闸:用户上翻历史时旧已答对话框会入视野,采样会假置位——非贴底停采
 * (状态冻结不误摘,作答/超时仍由字节流与写路径清位)。
 * 就绪前(回放/流式相位)停采:磁盘回放的墓碑帧不进屏幕通道(评审 F5)。
 */
export function startAskScreenProbe(
  term: Terminal,
  sessionId: string,
  isReady: () => boolean,
): () => void {
  const timer = setInterval(() => {
    if (!isReady()) return; /* 就绪前墓碑帧不进屏幕通道 */
    const buf = term.buffer.active;
    if (buf.baseY + term.rows < buf.length - 2) return; /* 上翻中:停采防旧卡假置位 */
    const bottom = Math.min(buf.length, buf.baseY + term.rows);
    let screenTail = "";
    for (let row = buf.baseY; row < bottom; row++) {
      screenTail += (buf.getLine(row)?.translateToString(true) ?? "") + "\n";
    }
    host.observeAskScreen(sessionId, screenTail);
  }, ASK_PROBE_MS);
  return () => clearInterval(timer);
}

/** 停滞探针依赖(全部由 TerminalView 供活性真相,避免闭包吃陈旧状态)。 */
export interface CanvasStallProbeDeps {
  sessionId: string;
  isActive: () => boolean;
  isStreamReady: () => boolean;
  getLastLiveAt: () => number;
  onRebuild: () => void;
}

/**
 * 幕布数据链停滞巡检(判据见 canvasStall.ts):PTY 缓冲字节仍在推进而本幕布
 * 订阅超静默窗未收字节 = 数据链断供(订阅丢失/回放悬死),自动重建幕布。误重建
 * 代价 = 无谓整幕回放,判据刻意保守(仅激活+就绪+渲染健康+PTY 在流)。
 * 「在流」真相 = 缓冲字节数变化(O(1),锚无关;压实回落也算变化)。
 */
export function startCanvasStallProbe(d: CanvasStallProbeDeps): () => void {
  let lastKickAt = 0;
  let lastBytes = -1;
  const timer = setInterval(() => {
    const bytes = host.getOutputBufferBytes(d.sessionId);
    const outputGrew = lastBytes >= 0 && bytes !== lastBytes;
    lastBytes = bytes;
    if (
      !shouldRebuildCanvas({
        now: Date.now(),
        active: d.isActive(),
        streamReady: d.isStreamReady(),
        outputGrew,
        lastLiveAt: d.getLastLiveAt(),
        rafGapMs: nativeRafGapMs(),
        lastKickAt,
      })
    ) {
      return;
    }
    lastKickAt = Date.now();
    d.onRebuild();
  }, STALL_PROBE_MS);
  return () => clearInterval(timer);
}

/**
 * 幕布终态屏幕(卸载补种载荷):当前视口逐行去尾空白。join 而非逐行 +\r\n:
 * 尾随换行会把末行滚出 scrollback=0 的物理屏;裸 \n 在终端里走楼梯。
 */
export function buildReseedScreen(term: Terminal): {
  cols: number;
  rows: number;
  text: string;
} {
  const buf = term.buffer.active;
  const bottom = Math.min(buf.length, buf.baseY + term.rows);
  const lines: string[] = [];
  for (let row = buf.baseY; row < bottom; row++) {
    lines.push(buf.getLine(row)?.translateToString(true) ?? "");
  }
  return { cols: term.cols, rows: term.rows, text: lines.join("\r\n") };
}
