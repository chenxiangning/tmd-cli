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
import { shouldRebuildCanvas, STALL_CANVAS_SILENCE_MS } from "@kernel/canvasStall";
import {
  HEAD_SAMPLE_CHARS,
  saveTerminalFreeze,
  sessionFreezeFingerprint,
} from "@kernel/terminalFreeze";

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
  let silentRun = 0;
  const timer = setInterval(() => {
    const now = Date.now();
    const bytes = host.getOutputBufferBytes(d.sessionId);
    const outputGrew = lastBytes >= 0 && bytes !== lastBytes;
    lastBytes = bytes;
    const lastLiveAt = d.getLastLiveAt();
    const silent = now - lastLiveAt >= STALL_CANVAS_SILENCE_MS;
    silentRun = silent ? silentRun + 1 : 0;
    if (
      !shouldRebuildCanvas({
        now,
        active: d.isActive(),
        streamReady: d.isStreamReady(),
        outputGrew,
        lastLiveAt,
        rafGapMs: nativeRafGapMs(),
        lastKickAt,
        silentRun,
      })
    ) {
      return;
    }
    lastKickAt = now;
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
  cursorX: number;
  cursorY: number;
} {
  const buf = term.buffer.active;
  const bottom = Math.min(buf.length, buf.baseY + term.rows);
  const lines: string[] = [];
  for (let row = buf.baseY; row < bottom; row++) {
    lines.push(buf.getLine(row)?.translateToString(true) ?? "");
  }
  return {
    cols: term.cols,
    rows: term.rows,
    text: lines.join("\r\n"),
    // 光标随投影一起存(xterm cursorY 视口相对 0..rows-1);读数异常回落 0/0(左上角,无损)
    cursorX: buf.cursorX ?? 0,
    cursorY: buf.cursorY ?? 0,
  };
}

/**
 * 幕布卸载收尾:镜像补种(语义不变)+ 挤除冻结快照存档(候选2)。投影一次
 * 计算两用;空缓冲(新会话/已退出即被清)不存。重建卸载(刷新钮/停滞自愈)的
 * 幕布可能滞留停滞期旧帧,存档由重挂侧弃存量兜底(见 TerminalView 主 effect),
 * 卸载侧不辨因一律存 —— 快照至多存活一次消费,误存不外溢。
 */
export function settleTerminalFreeze(sessionId: string, term: Terminal): void {
  const reseed = buildReseedScreen(term);
  host.reseedScreenMirror(sessionId, reseed.cols, reseed.rows, reseed.text);
  const bufferText = host.getOutputBuffer(sessionId);
  if (!bufferText) return;
  saveTerminalFreeze({
    sessionId,
    cols: reseed.cols,
    rows: reseed.rows,
    screenText: reseed.text,
    cursorX: reseed.cursorX,
    cursorY: reseed.cursorY,
    unloadChars: bufferText.length,
    bytePos: host.getOutputBufferBytes(sessionId),
    headSample: bufferText.slice(0, HEAD_SAMPLE_CHARS),
    fingerprint: sessionFreezeFingerprint(host.getSessions().find((s) => s.id === sessionId)),
  });
}

/**
 * 幕布尺寸观察 · 布局风暴合流 —— 面板开合/拖拽一拍内 ResizeObserver 连发,每发
 * 都触发整缓冲同步 rewrap(行数多时长达秒级),连续重排会把主线程按进 render_health
 * 探针 4s 静默窗,被误判悬死而 reload(重挂回放 = 阅读位丢失,2026-10-22 实锤)。
 * 尾沿合一:实际尺寸只在风暴停后应用一次;同步触发路径(挂载/设置)不走这里。
 */
export function observeCanvasSize(container: HTMLElement, onResize: () => void): () => void {
  let timer = 0;
  const observer = new ResizeObserver(() => {
    clearTimeout(timer);
    timer = window.setTimeout(onResize, 120);
  });
  observer.observe(container);
  return () => {
    clearTimeout(timer);
    observer.disconnect();
  };
}
