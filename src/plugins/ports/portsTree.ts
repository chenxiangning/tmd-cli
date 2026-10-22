/**
 * ports · 数据整形纯函数 —— 暴露面判定 / 端口+pid 去重 / 监听进程家族折叠归组 /
 * ppid 链会话归因。输入输出均为 types.ts 数据,无 IO。
 */

import type { Exposure, OsKind, OwnerSession, PortEntry, PortGroup, SortSpec } from "./types";
import { portPurpose } from "./purpose";

/** 通配与具体网卡地址都=局域网可达;仅回环地址算本机。 */
export function exposureOf(host: string): Exposure {
  const h = host.replace(/^\[/, "").replace(/\]$/, "");
  if (h === "127.0.0.1" || h === "::1") return "loopback";
  return "exposed";
}

/** 浏览器打开的目标主机:通配/缺失地址回落 localhost;具体地址(网卡 IP/IPv6 括号形)原样用。 */
export function browserHost(addr: string): string {
  const bare = addr.replace(/^\[/, "").replace(/\]$/, "");
  return !addr || bare === "*" || bare === "0.0.0.0" || bare === "::" ? "localhost" : addr;
}

/** 同一 (pid,port) 的多协议族行(lsof IPv4+IPv6 双行)去重,保留暴露面更宽的地址。 */
export function dedupeListeners(rows: PortEntry[]): PortEntry[] {
  const byKey = new Map<string, PortEntry>();
  const rank = (e: PortEntry) => (e.exposure === "loopback" ? 0 : 1);
  for (const r of rows) {
    const key = `${r.pid ?? "-"}:${r.port}`;
    const prev = byKey.get(key);
    if (!prev || rank(r) > rank(prev)) byKey.set(key, r);
  }
  return [...byKey.values()];
}

/**
 * 监听进程家族归组:每行沿 ppid 链上溯到家族顶层监听行(输入序无关),
 * 全族挂同一组;无监听祖先 = 自成顶层。pid null 恒顶层。ppid 环与断链防御。
 */
export function groupByFamily(rows: PortEntry[]): PortGroup[] {
  const byPid = new Map<number, PortEntry>();
  for (const r of rows) if (r.pid !== null) byPid.set(r.pid, r);
  const groups = new Map<number, PortGroup>();
  const tops: PortGroup[] = [];
  for (const r of rows) {
    /* pid null 无身份不可归组,恒顶层:Map 以 null 作键会让 ≥2 条无主行并成假家族 */
    if (r.pid === null) {
      tops.push({ top: r, children: [] });
      continue;
    }
    /* 链上溯:byPid 里能接上的监听祖先一路走到底,终点 = 家族顶层行。 */
    let top = r;
    const seen = new Set<number>([r.pid ?? -1]);
    for (;;) {
      const next = top.ppid != null ? byPid.get(top.ppid) : undefined;
      if (!next || seen.has(next.pid!)) break;
      seen.add(next.pid!);
      top = next;
    }
    let g = groups.get(top.pid!);
    if (!g) {
      g = { top, children: [] };
      groups.set(top.pid!, g);
      tops.push(g);
    }
    /* 归组判据 = 是否为组内存顶层行:同 pid 多端口时,非建组那行 ascend 终点是自身,
     *  与 top(同 pid 另一行)引用不同——按 g.top 判才能收进组,按 top 判会静默丢行。 */
    if (r !== g.top) g.children.push(r);
  }
  const byPort = (a: PortEntry, b: PortEntry) => a.port - b.port || (a.pid ?? 0) - (b.pid ?? 0);
  for (const g of tops) g.children.sort(byPort);
  tops.sort((a, b) => byPort(a.top, b.top));
  return tops;
}

/**
 * 会话归因:pid 自身或 ppid 链上溯(深度限 32,环防御)命中 PTY 会话 pid → 返回会话。
 * ppidOf 链由全量进程图谱供出(缺进程 = null 终止)。
 */
export function findOwnerSession(
  pid: number | null,
  ppidOf: (pid: number) => number | null,
  sessionByPid: Map<number, OwnerSession>,
  maxDepth = 32,
): OwnerSession | null {
  if (pid === null) return null;
  const self = sessionByPid.get(pid);
  if (self) return self;
  const seen = new Set<number>([pid]);
  let cur: number | null = pid;
  for (let d = 0; d < maxDepth; d++) {
    cur = ppidOf(cur);
    if (cur === null || seen.has(cur)) return null;
    seen.add(cur);
    const hit = sessionByPid.get(cur);
    if (hit) return hit;
  }
  return null;
}

/** 行去重新鲜度 key(pid 缺失用 addr 兜底,addr 非数字与 pid 键不撞)。 */
export function rowKey(e: PortEntry): string {
  return `${e.pid ?? e.addr}:${e.port}`;
}

/** 告警带是否需要渲染:任一告警源非空才挂 ViewAlerts(含 windows 平台常显提示)。 */
export function hasAlerts(
  error: string | null,
  notice: string | null,
  timedOut: boolean,
  outcome: { warnings: string[] } | null,
  os: OsKind,
): boolean {
  return Boolean(error || notice || timedOut || (outcome && outcome.warnings.length > 0) || os === "windows");
}

/* ── 列头排序 ── 家族组为一级结构:组按顶层行键排,组内子行同键排(子行不跨组比较)。
 * 空值(purpose 未命中/无仓库)恒沉底,与行的「—」显示语义一致。 */

function strCmp(a: string, b: string, dir: SortSpec["dir"]): number {
  return a.localeCompare(b) * (dir === "asc" ? 1 : -1);
}

function sortValue(e: PortEntry, key: SortSpec["key"], wsNames: Map<string, string>): string | number {
  switch (key) {
    case "port":
      return e.port;
    case "addr":
      return e.addr;
    case "exposure":
      return e.exposure === "exposed" ? 1 : 0;
    case "purpose":
      return portPurpose(e.port) ?? "";
    case "process":
      return e.process || e.args;
    case "repo": {
      const root = e.gitRoot?.replace(/\/+$/, "");
      return (root && (wsNames.get(root) ?? e.gitRoot)) || "";
    }
  }
}

/** 键比较:数字列按数值,字符串列 localeCompare;任一侧空串恒沉底(不随方向翻)。 */
export function bySortKey(key: SortSpec["key"], dir: SortSpec["dir"], wsNames: Map<string, string>) {
  return (a: PortEntry, b: PortEntry): number => {
    const va = sortValue(a, key, wsNames);
    const vb = sortValue(b, key, wsNames);
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * (dir === "asc" ? 1 : -1);
    const sa = String(va);
    const sb = String(vb);
    if (sa === "" || sb === "") return sa === sb ? 0 : sa === "" ? 1 : -1;
    return strCmp(sa, sb, dir);
  };
}

/** 组排序:浅拷贝组与子行(不改动 groupByFamily 的原产序),返回新数组。 */
export function sortGroups(groups: PortGroup[], spec: SortSpec, wsNames: Map<string, string>): PortGroup[] {
  const cmp = bySortKey(spec.key, spec.dir, wsNames);
  return groups
    .map((g) => ({ top: g.top, children: [...g.children].sort(cmp) }))
    .sort((x, y) => cmp(x.top, y.top));
}
