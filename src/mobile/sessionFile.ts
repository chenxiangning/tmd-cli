/**
 * 会话 transcript 获取:定位 CLI 磁盘 jsonl(omp/pi/claude)→ 尾部窗口 → 解析。
 * 路径发现只用已放行的 fs 只读面(fs_list_dir/fs_collect_files/fs_read_tail);
 * 找不到/读不到一律返回 null,UI 回落现有 PTY 尾流 —— 不阻塞会话屏。
 * 形状契约:ipc.ts 的 invoke 签名(path/maxBytes/dir/suffix)+ DirEntry/FileStamp。
 */
import { parseTranscript, tailTurns, type TranscriptTurn } from "@kernel/transcript";
import { shellLog } from "@kernel/shellBridge";

const TAIL_BYTES = 256 * 1024;
const MAX_TURNS = 40;

async function inv<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@kernel/transport");
  return invoke<T>(cmd, args);
}

/** 宿主用户根:config_home_dir(桌面进程主目录,已放行 + 桌面同款缓存语义)。 */
let hostRootCache: string | null = null;
async function hostRoot(): Promise<string | null> {
  if (hostRootCache) return hostRootCache;
  try {
    hostRootCache = await inv<string>("config_home_dir");
    return hostRootCache;
  } catch {
    return null;
  }
}

async function newestFile(dir: string): Promise<string | null> {
  try {
    const stamps = await inv<{ path: string; modifiedAt: number }[]>("fs_collect_files", {
      dir,
      suffix: ".jsonl",
    });
    if (!stamps.length) return null;
    return stamps.sort((a, b) => b.modifiedAt - a.modifiedAt)[0].path;
  } catch {
    return null;
  }
}

/** omp/pi 会话根下找 cwd 对应的 slug 目录(pi 目录名两端补 `-`,规则未文档化;
 *  以「去掉所有 - 后相等」匹配,兼容尾斜杠/前导杠任意变体)。 */
async function piSessionDir(root: string, cwd: string): Promise<string | null> {
  try {
    const dirs = await inv<{ name: string; path: string; isDir: boolean }[]>("fs_list_dir", {
      path: root,
    });
    const norm = (s: string) => s.replaceAll("-", "").toLowerCase();
    const target = norm(cwd);
    const hit = dirs.find((d) => d.isDir && norm(d.name) === target);
    return hit?.path ?? null;
  } catch {
    return null;
  }
}

/** 定位会话 jsonl;profileId 决定根目录布局(omp/pi 同源,claude 独立)。 */
export async function resolveTranscriptPath(
  profileId: string,
  cwd: string,
): Promise<string | null> {
  const home = await hostRoot();
  if (!home) return null;
  const p = profileId.toLowerCase();
  if (p === "claude" || p === "cl") {
    const norm = (s: string) => s.replaceAll("-", "").toLowerCase();
    const target = norm(cwd);
    const dir = `${home}/.claude/projects`;
    try {
      const dirs = await inv<{ name: string; path: string; isDir: boolean }[]>("fs_list_dir", {
        path: dir,
      });
      const hit = dirs.find((d) => d.isDir && norm(d.name) === target);
      return hit ? newestFile(hit.path) : null;
    } catch {
      return null;
    }
  }
  /* omp/pi/qoder: ~/.pi/agent/sessions/<cwd-slug>/*.jsonl(桌面内核同源) */
  const dir = await piSessionDir(`${home}/.pi/agent/sessions`, cwd);
  if (!dir) return null;
  return newestFile(dir);
}

/** 拉会话 transcript(最近 MAX_TURNS 条);任何一步失败 → null(UI 回落)。 */
export async function loadTranscript(
  profileId: string,
  cwd: string,
): Promise<TranscriptTurn[] | null> {
  const path = await resolveTranscriptPath(profileId, cwd);
  if (!path) {
    shellLog(`transcript: 未定位到 jsonl(profile=${profileId} cwd=${cwd})→ 回落实况`);
    return null;
  }
  return loadTranscriptAt(path);
}

/** 按会话文件路径拉 transcript(home 历史行;路径来自磁盘扫描,免再定位)。 */
export async function loadTranscriptAt(path: string): Promise<TranscriptTurn[] | null> {
  try {
    const tail = await inv<string>("fs_read_tail", { path, maxBytes: TAIL_BYTES });
    if (!tail) return null;
    const turns = parseTranscript(tail);
    if (!turns.length) shellLog(`transcript: 解析 0 行(${path})`);
    return turns.length ? tailTurns(turns, MAX_TURNS) : null;
  } catch (e) {
    shellLog(`transcript: 读取失败 ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    return null;
  }
}
