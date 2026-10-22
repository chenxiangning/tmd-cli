/**
 * ports · 数据类型 —— 扫描结果行/聚合组/归属会话。
 */

export type OsKind = "mac" | "linux" | "windows";

/** 监听地址暴露面:loopback 仅本机;exposed = 通配/具体网卡地址,局域网可达。 */
export type Exposure = "loopback" | "exposed";

/** 单个监听端口行(一个 pid 一个监听 socket 一行)。 */
export interface PortEntry {
  port: number;
  /** 监听地址主机部分(原始形态:*、0.0.0.0、[::]、127.0.0.1、具体网卡 IP)。 */
  addr: string;
  exposure: Exposure;
  /** 监听进程 pid;无权限/无 -p 支持时 null(kill 不可用)。 */
  pid: number | null;
  /** 进程短名(基名);未知为空串。 */
  process: string;
  /** 完整命令行(ps/PowerShell;未知为空串)。 */
  args: string;
  ppid: number | null;
  /** 进程 cwd(Windows 无公共 API → 恒 null)。 */
  cwd: string | null;
  /** cwd 反查的 git 仓库顶层;非仓库/Windows 为 null。 */
  gitRoot: string | null;
}

/** 折叠归组:同一监听进程家族的父子(如 npm→node 双监听)。 */
export interface PortGroup {
  top: PortEntry;
  children: PortEntry[];
}

/** 会话归因命中(本应用 PTY 会话起的服务)。 */
export interface OwnerSession {
  id: string;
  title?: string;
  profileId: string;
  workspaceId?: string;
}

/** 一次扫描的完整产出。 */
export interface ScanOutcome {
  rows: PortEntry[];
  os: OsKind;
  /** 实际应答的端口工具(linux ss 缺失回落 netstat 时可辨)。 */
  source: "lsof" | "ss" | "netstat";
  /** 全量进程 ppid 图谱(归因上溯用;含非监听进程)。 */
  ppidAll: Map<number, number>;
  /** 非致命步骤的失败说明(kill/过滤不受影响,顶部汇总提示)。 */
  warnings: string[];
  /** 任一扫描命令超时被截断(部分输出已解析,结果可能不完整)。 */
  timedOut: boolean;
}

/** 列头排序:家族组为一级结构,排序 = 组按顶层行键排、组内子行同键排。 */
export type SortKey = "port" | "addr" | "exposure" | "purpose" | "process" | "repo";
export type SortDir = "asc" | "desc";
export interface SortSpec {
  key: SortKey;
  dir: SortDir;
}
