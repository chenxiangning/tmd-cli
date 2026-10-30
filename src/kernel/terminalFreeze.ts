/**
 * 挤除冻结快照 —— tab 条容量挤除卸载幕布时保存的终态屏幕投影,重开免全量回放。
 *
 * 卸载路径本就算 buildReseedScreen 喂镜像补种(候选2:一次计算两用),顺手把
 * 投影连同缓冲水位存档;重开时若内存 outputBuffers 仍在且身份指纹匹配,先同步
 * 写投影上屏(免 0.5s 遮罩与全量回放),再从卸载水位起补写增量字节。投影是原
 * 字节序列的屏幕投影(与 reload reseed 同范式),PTY 字节 → xterm 透传不改。
 *
 * 字节真源仍在 outputBuffers(单消费者模块,不进 kernel 准入);会话关闭清缓冲
 * /从侧栏重开磁盘会话 = 存档天然不命中,走既有全量路径。
 */
import { getSettingsState } from "./settings";
/** 存档档位基线:LRU 上限;sessionTabsMax 配更高时跟随(见 freezeLimit)。 */
const FREEZE_LIMIT = 8;

/** 档位 = max(8, sessionTabsMax):配 9/10 tab 时固定 8 会让第 9 个起的
 * 挤除快照即存即弃,重开退化全量回放(2026-10-26 档位硬伤)。 */
function freezeLimit(): number {
  return Math.max(FREEZE_LIMIT, getSettingsState().settings.sessionTabsMax);
}

/** 缓冲头样本长度:重开时校验缓冲前缀完好(从头截断过 = 弃用快照走全量)。 */
export const HEAD_SAMPLE_CHARS = 48;

/** 一次挤除卸载的冻结快照。unloadChars/bytePos 是同一时刻缓冲的字符/字节水位。 */
export interface TerminalFreezeSnapshot {
  sessionId: string;
  /** 卸载时幕布栅格(重开若栅格变化由 xterm reflow,与全量回放+resize 同类,不作闸)。 */
  cols: number;
  rows: number;
  /** 卸载时终态屏幕投影(buildReseedScreen 同源载荷)。 */
  screenText: string;
  /** 投影时光标列/行(视口相对,0 起)。fast 路径写完投影后用 CSI H 还原,活跃 TUI 相对寻址不错位。 */
  cursorX: number;
  cursorY: number;
  /** 卸载时内存缓冲字符数(增量切片锚:重开缓冲以此为界切增量,UTF-16 码元)。 */
  unloadChars: number;
  /** 卸载时内存缓冲 UTF-8 字节数(快速否决;与翻页锚点 logSize-bytePos 同语义)。 */
  bytePos: number;
  /** 缓冲头样本:重开缓冲前缀必须吻合,证明卸载以来缓冲未从头截断。 */
  headSample: string;
  /** 会话进程身份指纹(pid+createdAt):防同 id 重 spawn 后错认旧屏幕。 */
  fingerprint: string;
}

/** 模块级存档(MRU 在 Map 尾部);key = sessionId,同会话重卸载覆盖刷新。 */
const store = new Map<string, TerminalFreezeSnapshot>();

/** 存档(挤除卸载路径调用);超档位从最旧逐出。 */
export function saveTerminalFreeze(snap: TerminalFreezeSnapshot): void {
  store.delete(snap.sessionId);
  store.set(snap.sessionId, snap);
  while (store.size > freezeLimit()) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/** 取出并删除(消费即弃:快照至多存活一次消费,重建/再挤除后旧快照不得复活)。 */
export function takeTerminalFreeze(sessionId: string): TerminalFreezeSnapshot | null {
  const snap = store.get(sessionId) ?? null;
  store.delete(sessionId);
  return snap;
}

/** 会话进程身份指纹:pid + createdAt,缺失字段以占位符参与比较。 */
export function sessionFreezeFingerprint(
  meta: { pid?: number; createdAt?: number } | null | undefined,
): string {
  return `${meta?.pid ?? "-"}:${meta?.createdAt ?? "-"}`;
}

/** 快照裁决结果:fast = 增量补写(文本为缓冲去掉卸载前缀的后缀,携带命中快照);full = 既有全量回放。 */
export type FreezeResolution =
  | { mode: "fast"; incremental: string; snap: TerminalFreezeSnapshot }
  | { mode: "full" };

/** 快照可用性裁决(纯函数,重开挂载路径调用)。指纹不匹配、水位回退(缓冲被清/
 *  截短)或前缀不完好(头样本不吻合 = 卸载后缓冲从头截断过)一律弃用走全量 —— 宁慢不错。 */
export function resolveFreezeReplay(
  curBuffer: string,
  curBytes: number,
  snap: TerminalFreezeSnapshot | null,
  fingerprint: string,
): FreezeResolution {
  if (!snap || snap.fingerprint !== fingerprint) return { mode: "full" };
  if (curBytes < snap.bytePos || curBuffer.length < snap.unloadChars) return { mode: "full" };
  if (curBuffer.slice(0, snap.headSample.length) !== snap.headSample) return { mode: "full" };
  /* 切点落在代理对中间回退一位:孤立低代理开头在 scrollback 渲染替换字形 */
  const from =
    snap.unloadChars > 0 &&
    snap.unloadChars < curBuffer.length &&
    curBuffer.charCodeAt(snap.unloadChars - 1) >= 0xd800 &&
    curBuffer.charCodeAt(snap.unloadChars - 1) <= 0xdbff
      ? snap.unloadChars - 1
      : snap.unloadChars;
  return { mode: "fast", incremental: curBuffer.slice(from), snap };
}
