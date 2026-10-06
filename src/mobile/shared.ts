/**
 * 手机 UI 共享件(非组件导出集中处:类型/常量/端点选择/通知入口)——
 * react-doctor「组件文件只出组件」纪律;数据面实现见 remote.ts/creds.ts。
 */
import React from "react";
import { t } from "@kernel/i18n";
import { hasShellBridge, shellNotify } from "@kernel/shellBridge";
import { invoke } from "@kernel/transport";
import type { TranscriptTurn } from "@kernel/transcript";
import { loadChannelPin, type MobileCreds } from "./creds";
import { tailHasAskMarker, type RemoteSession, type RemoteWorkspace } from "./remote";

/** 渲染分段(spec 2026-09-25-mobile-session-render):连续 tool turn 归组为一条
 *  折叠运行;纯渲染层折叠,数据与顺序不动。index = 段首元素在原 turns 中的
 *  下标(append-only,下标即稳定身份)。 */
export type TurnSegment =
  | { kind: "user" | "assistant"; turn: TranscriptTurn; index: number }
  | { kind: "run"; items: TranscriptTurn[]; index: number };

export function groupTurns(turns: TranscriptTurn[]): TurnSegment[] {
  const segs: TurnSegment[] = [];
  for (let i = 0; i < turns.length; i++) {
    const tn = turns[i]!;
    if (tn.role !== "tool") {
      segs.push({ kind: tn.role, turn: tn, index: i });
      continue;
    }
    const last = segs[segs.length - 1];
    if (last?.kind === "run") last.items.push(tn);
    else segs.push({ kind: "run", items: [tn], index: i });
  }
  return segs;
}

/** 壳要求的桌面协议能力(hello.capabilities 缺此 = block 屏;协议破坏性变更时步进)。 */
export const REQUIRED_CAPABILITY = "app-device";

/** 手机三层路由:home(列表)/ session(实况+审批+发送)/ history(只读 transcript)。 */
export interface MobileRoute {
  view: "home" | "session" | "history" | "git";
  sessionId?: string;
  /** view = session 且经 SpawnSheet 新建:spawn 水位(ms)。transcript 定位只收
   *  此后有写的 jsonl —— 新会话懒落盘窗口内不命中同 cwd 旧会话(历史泄露修复);
   *  home 列表点入既有会话不带 = 不过滤。 */
  spawnedAt?: number;
  /** view = history:磁盘会话定位信息(cwd/workspaceId/cliSessionId 齐备时可续聊)。 */
  history?: {
    profileId: string;
    path: string;
    title: string;
    cwd?: string;
    workspaceId?: string;
    cliSessionId?: string;
  };
}

/** 端点候选:钉选优先;auto = urls 序(配对时 LAN 在前),旧凭证回落单 wsUrl。 */
export function endpointCandidates(creds: MobileCreds): string[] {
  const all = creds.urls?.length ? creds.urls : [creds.wsUrl];
  const pin = loadChannelPin();
  if (pin !== "auto" && all.includes(pin)) return [pin];
  return all;
}

/** 端点网络域:私有网段/localhost = 内网(局域网直连),其余(中继域名) = 外网。 */
export function endpointKind(url: string): "lan" | "wan" {
  const host = url.replace(/^wss?:\/\//, "").split(/[/:]/)[0];
  if (/^(localhost|127\.)/.test(host)) return "lan";
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return "lan";
  return "wan";
}

/** ask 首现本地通知(壳态;SessionScreen 检测边沿调用)。 */
export function notifyAsk(title: string): void {
  if (!hasShellBridge()) return;
  void shellNotify(t("等待确认"), title).catch(() => undefined);
}

/** 会话退出本地通知(与 ask 同通道;桌面侧的轮次结束通知不在手机面,留观)。 */
export function notifyExit(title: string): void {
  if (!hasShellBridge()) return;
  void shellNotify(t("会话已退出"), title).catch(() => undefined);
}

/** ask 轮次台账(sessionId → 本轮已通知):上升沿通知一次,标记消失清账。
 *  home 轮询与 SessionScreen 实况检测共用同一本内存账,同一轮天然只报一次。 */
const askRounds = new Map<string, boolean>();

/** ask 边沿上报:present = 尾窗当前是否命中标记;false→true 沿触发 notifyAsk。 */
export function askEdgeNotify(sessionId: string, present: boolean, title: string): void {
  if (present) {
    if (askRounds.get(sessionId)) return;
    askRounds.set(sessionId, true);
    notifyAsk(title);
  } else {
    askRounds.delete(sessionId);
  }
}

/** 单会话 ask 检查:拉尾页(8K,标记只在末屏)跑标记走边沿台账。
 *  home 轮询(pollHomeWatch)与事件化沿检测(MobileApp turnActive 下降沿)共用,
 *  同一 askRounds 台账保证幂等。失败 = 抛出由调用方吞(留下一轮)。 */
export async function checkSessionAsk(id: string, title: string): Promise<void> {
  const page = await invoke<{ text: string }>("session_history_page", {
    id,
    before: Number.MAX_SAFE_INTEGER,
    maxBytes: 8192,
  });
  askEdgeNotify(id, await tailHasAskMarker(page.text ?? ""), title);
}

/** 会话终局清账(pty://exit / 列表消失时调)。 */
export function askRoundClear(sessionId: string): void {
  askRounds.delete(sessionId);
}

/** turnActive 下降沿收集(ask 事件化沿检测,2026-10-06):维护 prev 快照,
 *  返回本轮从活动翻空闲的会话 —— ask 首现必伴随活动翻 idle(sessions:changed
 *  驱动列表重拉),沿上拉尾页检查即事件级检出(替代他屏 60s 轮询拍)。首见
 *  与上升沿不触发;消失会话顺手清账。纯内存 diff,快照由调用方持有。 */
export function collectIdleEdges(
  prev: Map<string, boolean>,
  sessions: RemoteSession[],
): RemoteSession[] {
  const out: RemoteSession[] = [];
  const live = new Set<string>();
  for (const s of sessions) {
    live.add(s.id);
    const active = !!s.activity?.turnActive;
    if (prev.get(s.id) === true && !active) out.push(s);
    prev.set(s.id, active);
  }
  for (const id of prev.keys()) if (!live.has(id)) prev.delete(id);
  return out;
}
/** home 轮询一轮(逐会话串行削峰,对齐磁盘历史扫描纪律):审批线待审数 +
 *  运行中会话 ask 首现边沿(尾页 8K 跑标记,标记只在末屏)。checkpoint 失败
 *  记 0;尾页失败跳过(台账不动,留下一轮)。skipAskOf = 会话屏正打开的会话
 *  (实况检测更即时,不重复拉尾页)。 */
export async function pollHomeWatch(
  items: { id: string; cwd: string; title: string; running: boolean }[],
  skipAskOf?: string,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  /* 单会话一轮:审批线待审数 + 运行中会话 ask 首现边沿。 */
  const pollOne = async (
    it: { id: string; cwd: string; title: string; running: boolean },
  ): Promise<void> => {
    try {
      const batches = await invoke<{ open: boolean; state: string }[]>("checkpoint_list", {
        cwd: it.cwd,
        sessionId: it.id,
        tmdSessionId: it.id,
      });
      out[it.id] = batches.filter((b) => !b.open && b.state === "pending").length;
    } catch {
      out[it.id] = 0;
    }
    if (!it.running || it.id === skipAskOf) return;
    try {
      await checkSessionAsk(it.id, it.title);
    } catch {
      /* 断连/死会话:本轮跳过(台账不动,留下一轮) */
    }
  };
  /* 逐会话串行削峰(对齐磁盘历史扫描纪律):reduce 链 = 前一项 await 落定
   * 才起下一项,与 for-of 逐项 await 严格同序同时序,一次只发一个请求;
   * 禁止改成 Promise.all 并发(会把削峰变成齐发)。 */
  await items.reduce((chain, it) => chain.then(() => pollOne(it)), Promise.resolve());
  return out;
}

/** 手机路由 Context(MobileApp 提供,子屏消费)。 */
export interface MobileCtxValue {
  creds: MobileCreds;
  sessions: RemoteSession[];
  workspaces: RemoteWorkspace[];
  /** workspaces 首拉是否已成功(冷启动「未加载」与「确无工作区」的分流依据)。 */
  wsLoaded: boolean;
  titles: Record<string, string>;
  /** 归档覆盖层键集(wsId:profileId:cliSessionId;桌面 settings.sessionArchive 只读镜像)。 */
  archive: Set<string>;
  /** 置顶覆盖层(桌面 settings.sessionPins 只读镜像;写走 togglePin)。 */
  pins: Record<string, { title?: string; pinnedAt?: number }>;
  connected: boolean;
  /** 手动断开(已停止自动重连)。 */
  paused: boolean;
  route: MobileRoute;
  go: (r: MobileRoute) => void;
  titleOf: (s: RemoteSession) => string;
  /** 置顶切换(session_pin_toggle 窄令;key = wsId:profileId:cliSessionId)。 */
  togglePin: (key: string, title: string) => Promise<void>;
  onRePair: () => void;
}

export const MobileAppCtx = React.createContext<MobileCtxValue | null>(null);

export function useMobile(): MobileCtxValue {
  const v = React.useContext(MobileAppCtx);
  if (!v) throw new Error("MobileAppCtx outside provider");
  return v;
}

/** 壳标记判定(手机独立树入口;桌面/浏览器 false)。 */
export function isMobileShell(): boolean {
  return typeof window !== "undefined" && window.__TMD_SHELL__ === "mobile";
}

/** 审批线批次(线上 JSON camelCase;数据形状与排序归 shared,组件文件只出组件)。 */
export interface CkptLite {
  id: string;
  index: number;
  open: boolean;
  ts: number;
  state: string;
  prompt: string;
  files: unknown[];
}

/** 排序:进行中(open)最前,其余按轮次倒序(新批在上)。 */
export function sortBatches(bs: CkptLite[]): CkptLite[] {
  return [...bs].sort((a, b) => Number(b.open) - Number(a.open) || b.index - a.index);
}

/** 键盘工具条键表(两行大键网格,spec 2026-10-03-mobile-keybar-relayout):
 * 行1 导航五键(D-pad 心智,↑↓ 在中),行2 功能六键;PTY 序列契约不变。 */
export interface KeyDef {
  label: string;
  seq: string;
  aria: string;
}

export const KEY_ROWS: KeyDef[][] = [
  [
    { label: "←", seq: "\x1b[D", aria: "Left" },
    { label: "↑", seq: "\x1b[A", aria: "Up" },
    { label: "↓", seq: "\x1b[B", aria: "Down" },
    { label: "→", seq: "\x1b[C", aria: "Right" },
    { label: "↵", seq: "\r", aria: "Enter" },
  ],
  [
    { label: "esc", seq: "\x1b", aria: "Esc" },
    { label: "tab", seq: "\t", aria: "Tab" },
    { label: "⌃c", seq: "\x03", aria: "Ctrl+C" },
    { label: "Pg↑", seq: "\x1b[5~", aria: "PageUp" },
    { label: "Pg↓", seq: "\x1b[6~", aria: "PageDown" },
    { label: "model", seq: "/model\r", aria: "切换模型" },
  ],
];

/** home 可见性(route 在 home 且文档前台):列表轮询节流开关(2026-10-05 列表
 * 查询优化 P1)—— 他屏/后台时磁盘历史停扫、审批降频,回 home 重挂立扫补轮。 */
export function useHomeVisible(inRoute: boolean): boolean {
  const [visible, setVisible] = React.useState(inRoute && !document.hidden);
  React.useEffect(() => {
    const sync = () => setVisible(inRoute && !document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [inRoute]);
  return visible;
}

