/**
 * 手机会话状态条数据探针 —— 复用桌面 cli-* 插件的纯读取器/额度抓取器
 * (全部走 @kernel/ipc,WS 桥自动远程路由;spec 2026-10-06-mobile-status-bar)。
 *
 * 跨插件消费先例声明(mobile → cli-* 插件与 cli-shared 纯模块,同 history.ts/
 * timelineData.ts 先例):
 * - 状态读取:@plugins/cli-shared/piFamily(omp/pi)、cli-claude/sessions、
 *   cli-codex/sessionStatus、cli-grok/sessions、cli-opencode/db、
 *   cli-shared/qoderSessionModel(qoder/qoder-cn)、cli-kimi/configStatus;
 * - 额度抓取:@plugins/cli-{omp,pi,claude,codex,grok}/quota。
 * dsh 的读取器是 host RPC(readHostSessionStatus 需连接句柄),桥不可及 → null。
 */

import { t } from "@kernel/i18n";
import type { CliSessionStatus } from "@kernel/cli";
import { SHORT_WINDOW_LABEL, type QuotaFetchContext, type QuotaSnapshot } from "@kernel/quota";
import { piFamilySessions } from "@plugins/cli-shared/piFamily";
import { readQoderSessionStatus } from "@plugins/cli-shared/qoderSessionModel";
import { ompSessionsDir } from "@plugins/cli-omp/edits";
import { piSessionsDir } from "@plugins/cli-pi/edits";
import { readClaudeSessionStatus } from "@plugins/cli-claude/sessions";
import { readCodexSessionStatus } from "@plugins/cli-codex/sessionStatus";
import { readGrokSessionStatus } from "@plugins/cli-grok/sessions";
import { readOpencodeSessionStatus } from "@plugins/cli-opencode/db";
import { readKimiConfigStatus } from "@plugins/cli-kimi/configStatus";
import { fetchOmpQuota } from "@plugins/cli-omp/quota";
import { fetchPiQuota } from "@plugins/cli-pi/quota";
import { fetchClaudeQuota } from "@plugins/cli-claude/quota";
import { fetchCodexQuota } from "@plugins/cli-codex/quota";
import { fetchGrokQuota } from "@plugins/cli-grok/quota";

/** 会话态读取器:引擎 → (cwd, cliSessionId)。kimi 全局配置态无会话也可读;
 *  其余引擎无磁盘身份(未绑定 cliSessionId)= 不可读,返 null。 */
const STATUS_READERS: Record<
  string,
  (cwd: string, cliSessionId: string) => Promise<CliSessionStatus | null>
> = {
  /* modelKeys/providerKeys 与桌面 profile 声明逐字对齐(cli-omp 缺省 ["model"],
     cli-pi ["modelId","model"]/["provider","providerId"])。 */
  omp: (cwd, id) => piFamilySessions({ sessionsDir: ompSessionsDir }).readSessionStatus(cwd, id),
  pi: (cwd, id) =>
    piFamilySessions({
      sessionsDir: piSessionsDir,
      modelKeys: ["modelId", "model"],
      providerKeys: ["provider", "providerId"],
    }).readSessionStatus(cwd, id),
  claude: readClaudeSessionStatus,
  codex: readCodexSessionStatus,
  grok: readGrokSessionStatus,
  opencode: readOpencodeSessionStatus,
  qoder: (cwd, id) => readQoderSessionStatus(".qoder", cwd, id),
  "qoder-cn": (cwd, id) => readQoderSessionStatus(".qoder-cn", cwd, id),
};

/** 手机端会话状态读取;不支持(dsh)/未绑定身份/读取失败一律 null。 */
export async function readMobileSessionStatus(
  profileId: string,
  cwd: string,
  cliSessionId?: string,
): Promise<CliSessionStatus | null> {
  try {
    if (profileId === "kimi") return await readKimiConfigStatus();
    const reader = STATUS_READERS[profileId];
    if (!reader || !cliSessionId) return null;
    return await reader(cwd, cliSessionId);
  } catch {
    return null;
  }
}

/** 有额度抓取器的引擎(kimi/qoder/opencode 桌面亦无 fetcher;dsh 有但走
 *  host RPC(readHostContextPressure 需连接句柄),桥不可及)。 */
const QUOTA_FETCHERS: Record<string, (ctx: QuotaFetchContext) => Promise<QuotaSnapshot>> = {
  omp: fetchOmpQuota,
  pi: fetchPiQuota,
  claude: fetchClaudeQuota,
  codex: fetchCodexQuota,
  grok: fetchGrokQuota,
};

export function hasMobileQuotaFetcher(profileId: string): boolean {
  return profileId in QUOTA_FETCHERS;
}

/** 手机端额度抓取;无 fetcher 返 null,失败 throw 上交(调用方显「—」)。 */
export async function fetchMobileQuota(
  profileId: string,
  ctx: QuotaFetchContext,
): Promise<QuotaSnapshot | null> {
  const fetcher = QUOTA_FETCHERS[profileId];
  if (!fetcher) return null;
  return fetcher(ctx);
}

/** 额度快照 → 行内短文本:余额直出;窗口 = 短标 + 剩余百分比,「 · 」连接;
 * 错误/空窗返 null(调用方显「额度 —」)。 */
export function formatQuotaLine(s: QuotaSnapshot): string | null {
  if (s.error) return null;
  if (s.balanceText) return s.balanceText;
  const parts = s.windows.map(
    (w) => t("{label} 剩 {p}%", { label: SHORT_WINDOW_LABEL[w.label] ?? w.label, p: 100 - w.displayPercent }),
  );
  return parts.length ? parts.join(" · ") : null;
}
