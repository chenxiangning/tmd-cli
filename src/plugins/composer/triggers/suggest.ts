/**
 * 触发器下拉的"查找候选"逻辑 —— 与 UI 分离,纯函数。
 *
 * 三类触发符:
 * - @ (file):从 fsListDir 拉目录内容,按前缀过滤
 * - / (command):从 cli profile.suggestions.command 拉
 * - $ (skill):从 cli profile.suggestions.skill 拉
 */

import type { CliProfile, CliSuggestion, CliTriggerSpec } from "@kernel/cli";
import type { DirEntry } from "@kernel/ipc";
import { ipc } from "@kernel/ipc";

/* @ 文件触发目录缓存:同一目录 60s 内复用 fsListDir 结果。
   连续敲击路径字符每键一次 IPC,缓存把目录列举压到每目录每分钟一次;
   失败不缓存(下次击键重试),避免把瞬时错误固化一分钟。 */
const DIR_CACHE_TTL_MS = 60_000;
const dirListCache = new Map<string, { at: number; entries: DirEntry[] }>();

async function listDirCached(dir: string): Promise<DirEntry[]> {
  const hit = dirListCache.get(dir);
  if (hit && Date.now() - hit.at < DIR_CACHE_TTL_MS) return hit.entries;
  const entries = await ipc.fsListDir(dir);
  dirListCache.set(dir, { at: Date.now(), entries });
  return entries;
}

export interface SuggestionMatch {
  /** 替换进文本的值(不含 char)。 */
  value: string;
  /** 下拉的描述文本。 */
  description?: string;
  /** file 时携带的绝对路径,用于 hint;非 file 留空。 */
  detail?: string;
}

/**
 * 当前激活会话触发器在当前 text + cursor 上的查询。
 * 返回命中的 trigger 描述 + 候选列表。
 */
export async function lookupSuggestions(
  profile: CliProfile,
  triggerSpec: CliTriggerSpec,
  tokenText: string,
): Promise<SuggestionMatch[]> {
  const needle = tokenText.slice(triggerSpec.char.length);
  switch (triggerSpec.kind) {
    case "command":
      return filterDeclared(profile.suggestions?.command, needle);
    case "skill":
      return filterDeclared(profile.suggestions?.skill, needle);
    case "file": {
      // @ 后半:可能是目录前缀路径 —— 取最后一段为 dir,prefix 为最后/后
      // 例如 "/Users/x/src/k" → dir=/Users/x/src prefix=k
      const sep = needle.lastIndexOf("/");
      const dir = sep >= 0 ? needle.slice(0, sep) || "/" : ".";
      const prefix = sep >= 0 ? needle.slice(sep + 1) : needle;
      let entries: DirEntry[] = [];
      try {
        entries = await listDirCached(dir);
      } catch {
        return [];
      }
      return entries
        .filter((e) => e.name.toLowerCase().startsWith(prefix.toLowerCase()))
        .slice(0, 20)
        .map<SuggestionMatch>((e) => ({
          /* 文件与目录同规则保留目录前缀:@src/fo 选 foo.ts → @src/foo.ts,
             只回 basename 会让 CLI 收到指向根目录的不存在路径 */
          value: `${needle.replace(/[^/]*$/, "")}${e.name}${e.isDir ? "/" : ""}`,
          description: e.isDir ? "目录" : "文件",
          detail: e.path,
        }));
    }
  }
}

function filterDeclared(
  list: readonly CliSuggestion[] | undefined,
  needle: string,
): SuggestionMatch[] {
  if (!list) return [];
  const lower = needle.toLowerCase();
  return list
    .filter((s) => s.value.toLowerCase().startsWith(lower))
    .map<SuggestionMatch>((s) => ({ value: s.value, description: s.description }));
}
