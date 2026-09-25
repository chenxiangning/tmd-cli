/**
 * 手机续聊磁盘历史会话 —— 复刻桌面 openDiskSession 的语义,零新命令面:
 * spawn(session_spawn 已在 AppDevice 白名单)带引擎 resumeArgs + 工作区 cwd。
 * 去重(同一磁盘会话绝不出两条 PTY):
 * 1. 本连接期内开过的记内存表(key = profileId:cliSessionId);
 * 2. 桌面/手机开过都会写日志指针 ~/.tmd-cli/session/<slug(引擎)>/<slug(cwd)>/<cliId>.logptr
 *    (fs_read_file 已放行);指针存在且其 logId 仍在 session_list = 有活 PTY → 直接聚焦。
 *    指针缺/日志已死 = 冷开。桌面 acquireResume 预热池不在手机视野(手机自己 spawn 冷路径,
 *    omp 秒级加载可接受;M1 取舍)。
 */
import { invoke } from "@kernel/transport";
import { engineOf } from "./engines";
import type { RemoteSession } from "./remote";

/** home 目录连接期缓存(评审三轮:外网每 resume 省 1 个串行 RTT;桌面重启也基本不变)。 */
let homeDir: string | null = null;

/** 本连接期开过的会话(重进历史屏不重复 spawn)。 */
const opened = new Map<string, string>();

function slug(s: string): string {
  return s.replace(/[/\\:]/g, "-");
}

/** 读日志指针文件(桌面/手机开过历史会话都会写);缺/失败 = null。 */
async function pointerOf(home: string, profileId: string, cwd: string, cliSessionId: string): Promise<string | null> {
  const p = `${home}/.tmd-cli/session/${slug(profileId)}/${slug(cwd)}/${cliSessionId}.logptr`;
  try {
    const t = await invoke<string>("fs_read_file", { path: p });
    return t.trim() || null;
  } catch {
    return null;
  }
}

/**
 * 打开(或聚焦)磁盘会话的活 PTY,返回 PTY 会话 id。
 * 返回 null = 引擎不在手机表/工作区缺,调用方提示。
 */
export async function resumeDiskSession(args: {
  profileId: string;
  cwd: string;
  cliSessionId: string;
  workspaceId?: string;
  sessions: RemoteSession[];
}): Promise<string | null> {
  const engine = engineOf(args.profileId);
  if (!engine || !args.cwd) return null;
  const key = `${args.profileId}:${args.cliSessionId}`;
  const known = opened.get(key);
  if (known && args.sessions.some((s) => s.id === known)) return known;
  /* 内存表失效(重连/桌面重启后 id 变):按磁盘指针找上一代 logId,仍在活表即聚焦 */
  if (homeDir === null) homeDir = await invoke<string>("config_home_dir").catch(() => "");
  const home = homeDir;
  if (home) {
    const logId = await pointerOf(home, args.profileId, args.cwd, args.cliSessionId);
    if (logId && args.sessions.some((s) => s.id === logId)) {
      opened.set(key, logId);
      return logId;
    }
  }
  const r = await invoke<{ id: string }>("session_spawn", {
    profileId: args.profileId,
    spec: {
      command: engine.cmd,
      args: engine.resume(args.cliSessionId),
      cwd: args.cwd,
      cols: 80,
      rows: 24,
      env: {},
    },
    workspaceId: args.workspaceId,
    /* 磁盘身份直注注册表(桥 spawn 参数):桌面装配/标题解析/手机置顶 key 即刻可用,
       不再依赖前端身份探测(懒落盘 35-44s 窗) */
    cliSessionId: args.cliSessionId,
  });
  opened.set(key, r.id);
  return r.id;
}
