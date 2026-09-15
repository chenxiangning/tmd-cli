/**
 * 最新版本识别 —— npm registry `/latest` 端点 + 版本比较。
 *
 * 设计决策:
 * - HTTP 走 kernel 的 quota_fetch 通用代理(Rust reqwest,15s 超时),
 *   webview 直 fetch registry 会撞 CSP;不新增 Rust command,npm 语义留在本插件。
 * - claude 虽走 native 安装器,但 @anthropic-ai/claude-code 在 npm 持续发布,
 *   四个引擎统一 registry 一条链路,不为 claude 单开渠道。
 * - 失败语义:网络挂/包不存在/响应畸形 → null,调用方静默不渲染,绝不抛错。
 */

import { ipc } from "@kernel/ipc";

/** 模块级 TTL 缓存:WelcomePage 每次回首页都重挂载,不缓存会对 8 个引擎
 *  各发一次 registry 请求;5 分钟内同包直接复用(失败不缓存,下次重试)。 */
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; version: string }>();

/**
 * 查 npm registry 上某包的最新版本(dist-tags.latest)。
 * scoped 包 encodeURIComponent 后 `@openai/codex` → `%40openai%2Fcodex`,registry 接受。
 * opts.force = 标题条手动刷新:跳过 TTL 直连 registry(结果照常回填缓存)。
 */
export async function fetchLatestVersion(
  npmPackage: string,
  opts?: { force?: boolean },
): Promise<string | null> {
  if (!opts?.force) {
    const hit = cache.get(npmPackage);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.version;
  }
  try {
    const res = await ipc.quotaFetch({
      url: `https://registry.npmjs.org/${encodeURIComponent(npmPackage)}/latest`,
    });
    if (res.status !== 200) return null;
    const body = res.body as { version?: unknown } | null;
    if (typeof body?.version !== "string") return null;
    cache.set(npmPackage, { at: Date.now(), version: body.version });
    return body.version;
  } catch {
    return null;
  }
}

/** semver 三元组数值比较:a>b 正,a<b 负,等 0;不可解析的段按 0。 */
export function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/**
 * 从探针原始版本串抠首个 semver 三元组。
 * 覆盖 "omp/18.0.11"、"codex-cli 0.152.0"、"2.1.251 (Claude Code)" 等格式;
 * 抠不出 = null(调用方按"无法比较"处理,不误报过期)。
 */
export function extractSemver(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/\d+\.\d+\.\d+/);
  return m ? m[0] : null;
}

/** registry versions 键集 → 稳定版(滤 prerelease)semver 降序前 limit 个。 */
export function pickStableVersions(versions: string[], limit = 10): string[] {
  return versions
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
    .sort((a, b) => compareSemver(b, a))
    .slice(0, limit);
}

/** 版本列表 TTL 缓存(与最新版同口径:失败不缓存,下次开菜单重试)。 */
const listCache = new Map<string, { at: number; versions: string[] }>();

/**
 * 拉 npm registry 上某包的最新 10 个稳定版(版本菜单用)。
 * 精简 metadata(Accept: install-v1)即含全量 versions 键,比完整文档省一个数量级。
 * 失败语义同 fetchLatestVersion:null,调用方显「获取失败 · 重试」,绝不抛错。
 */
export async function fetchVersionList(npmPackage: string): Promise<string[] | null> {
  const hit = listCache.get(npmPackage);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.versions;
  try {
    const res = await ipc.quotaFetch({
      url: `https://registry.npmjs.org/${encodeURIComponent(npmPackage)}`,
      headers: { Accept: "application/vnd.npm.install-v1+json" },
    });
    if (res.status !== 200) return null;
    const body = res.body as { versions?: unknown } | null;
    if (!body?.versions || typeof body.versions !== "object") return null;
    const versions = pickStableVersions(Object.keys(body.versions));
    listCache.set(npmPackage, { at: Date.now(), versions });
    return versions;
  } catch {
    return null;
  }
}

/** 当前版本是否落后于最新版本。任一无法解析 = false(不误导用户点更新)。 */
export function isOutdated(
  currentRaw: string | null | undefined,
  latestRaw: string | null,
): boolean {
  const current = extractSemver(currentRaw);
  const latest = extractSemver(latestRaw);
  if (!current || !latest) return false;
  return compareSemver(latest, current) > 0;
}
