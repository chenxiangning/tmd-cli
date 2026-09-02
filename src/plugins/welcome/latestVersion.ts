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

/**
 * 查 npm registry 上某包的最新版本(dist-tags.latest)。
 * scoped 包 encodeURIComponent 后 `@openai/codex` → `%40openai%2Fcodex`,registry 接受。
 */
export async function fetchLatestVersion(
  npmPackage: string,
): Promise<string | null> {
  try {
    const res = await ipc.quotaFetch({
      url: `https://registry.npmjs.org/${encodeURIComponent(npmPackage)}/latest`,
    });
    if (res.status !== 200) return null;
    const body = res.body as { version?: unknown } | null;
    return typeof body?.version === "string" ? body.version : null;
  } catch {
    return null;
  }
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

/** 当前版本是否落后于最新版本。任一无法解析 = false(不误导用户点更新)。 */
export function isOutdated(
  currentRaw: string | null | undefined,
  latestRaw: string | null,
): boolean {
  const current = extractSemver(currentRaw);
  const latest = extractSemver(latestRaw);
  if (!current || !latest) return false;
  const cur = current.split(".").map(Number);
  const lat = latest.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (lat[i] > cur[i]) return true;
    if (lat[i] < cur[i]) return false;
  }
  return false;
}
