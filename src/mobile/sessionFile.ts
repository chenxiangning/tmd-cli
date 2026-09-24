/**
 * 会话 transcript 获取:定位 CLI 磁盘 jsonl(omp/pi/claude)→ 尾部窗口 → 解析。
 * 路径发现只用已放行的 fs 只读面(fs_list_dir/fs_collect_files/fs_read_tail);
 * 找不到/读不到一律返回 null,UI 回落现有 PTY 尾流 —— 不阻塞会话屏。
 * 形状契约:ipc.ts 的 invoke 签名(path/maxBytes/dir/suffix)+ DirEntry/FileStamp。
 */
import { parseTranscript, tailTurns, type TranscriptTurn } from "@kernel/transcript";
import { shellLog } from "@kernel/shellBridge";
import { invoke } from "@kernel/transport";
/* slug 构造复用桌面权威实现(评审 P1-1:目录名反匹配双侧恒不等,transcript 层全灭):
 * pi `--cwd--`、omp `-cwd-`、claude 全非字母数字划一,全在插件侧单一来源;
 * 根目录也由适配器给出(omp 在 ~/.omp,旧实现误查 ~/.pi)。 */
import { claudeSessionsDir } from "@plugins/cli-claude/sessions";
import { ompSessionsDir } from "@plugins/cli-omp/edits";
import { piSessionsDir } from "@plugins/cli-pi/edits";

const TAIL_BYTES = 256 * 1024;
const MAX_TURNS = 40;

async function newestFile(dir: string): Promise<string | null> {
  try {
    const stamps = await invoke<{ path: string; modifiedAt: number }[]>("fs_collect_files", {
      dir,
      suffix: ".jsonl",
    });
    if (!stamps.length) return null;
    return stamps.sort((a, b) => b.modifiedAt - a.modifiedAt)[0].path;
  } catch {
    return null;
  }
}

/** 定位会话 jsonl:插件适配器直接给出 cwd 对应会话目录(确定性 slug,无目录名反匹配)。 */
export async function resolveTranscriptPath(
  profileId: string,
  cwd: string,
): Promise<string | null> {
  const p = profileId.toLowerCase();
  const dir =
    p === "claude" || p === "cl"
      ? await claudeSessionsDir(cwd)
      : p === "pi"
        ? await piSessionsDir(cwd)
        : p === "omp"
          ? await ompSessionsDir(cwd)
          : null; /* qoder/kimi/grok/codex:磁盘布局非 cwd-slug 模型,不在手机 transcript 契约,回落实况 */
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
    const tail = await invoke<string>("fs_read_tail", { path, maxBytes: TAIL_BYTES });
    if (!tail) return null;
    const turns = parseTranscript(tail);
    if (!turns.length) shellLog(`transcript: 解析 0 行(${path})`);
    return turns.length ? tailTurns(turns, MAX_TURNS) : null;
  } catch (e) {
    shellLog(`transcript: 读取失败 ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    return null;
  }
}
