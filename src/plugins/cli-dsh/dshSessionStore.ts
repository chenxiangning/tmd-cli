/**
 * DSH 会话盘定位 —— `~/.dsh/sessions/<slug>/<dir>/session[.vN].jsonl.zstd`
 * 的目录名与文件名判据(删除与转录**共用一处**,防两处漂移)。
 *
 * 主判据(2026-10-02 全库 350 个会话目录实测,0 例外):**目录名 === header.id
 * === session/list 的 sessionId**。其中 244 条 id 本身就带 `session-` 前缀
 * (前缀属于 id,不是目录命名代际),所以既不能剥前缀也不能无脑加前缀。
 * `session-<id>` 是历史实现的猜测写法,这里作为兼容候选保留(转录老实现即两种
 * 都认),命中顺序为先 id 本体。
 *
 * slug 规则不猜:会话 id 全局唯一,扫一层 slug 目录按候选目录名命中即可。
 * 文件名带格式版本号(v0/v3/v4 并存于不同会话):通配 `session*.jsonl.zstd`
 * 取版本最高者,未来 v5 免改。
 */

import { ipc } from "@kernel/ipc";

/** 会话目录名候选:id 本体优先(+ 历史 `session-` 前缀兼容候选)。 */
export function dshSessionDirNames(cliSessionId: string): string[] {
  const PREFIX = "session-";
  if (cliSessionId.startsWith(PREFIX)) {
    const bare = cliSessionId.slice(PREFIX.length);
    return bare ? [cliSessionId, bare] : [cliSessionId];
  }
  return [cliSessionId, `${PREFIX}${cliSessionId}`];
}

/** session[.vN].jsonl.zstd → 盘面格式版本号(无版本段 = 0);非会话盘文件 = -1。 */
export function zstdVersionOf(name: string): number {
  const m = /^session(?:\.v(\d+))?\.jsonl\.zstd$/.exec(name);
  return m ? Number(m[1] ?? 0) : -1;
}

/** 扫 `~/.dsh/sessions` 下一层 slug 目录定位会话目录(找不到 = null:不猜 slug)。 */
export async function findDshSessionDir(cliSessionId: string): Promise<string | null> {
  if (!cliSessionId) return null;
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return null;
  const want = new Set(dshSessionDirNames(cliSessionId));
  const slugs = await ipc.fsListDir(`${home}/.dsh/sessions`).catch(() => []);
  for (const slug of slugs) {
    if (!slug.isDir) continue;
    const hit = (await ipc.fsListDir(slug.path).catch(() => []))
      .find((e) => e.isDir && want.has(e.name));
    if (hit) return hit.path;
  }
  return null;
}

/** 会话目录内版本最高的会话盘文件绝对路径(无会话盘 = null)。 */
export async function findDshSessionZstd(cliSessionId: string): Promise<string | null> {
  const dir = await findDshSessionDir(cliSessionId);
  if (!dir) return null;
  const best = (await ipc.fsListDir(dir).catch(() => []))
    .map((e) => ({ name: e.name, ver: zstdVersionOf(e.name) }))
    .filter((f) => f.ver >= 0)
    .sort((a, b) => b.ver - a.ver)[0];
  return best ? `${dir}/${best.name}` : null;
}
