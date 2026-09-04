/**
 * Quota provider 注册点 —— 每个 cli-* 插件注册自己的额度查询器。
 *
 * 设计:
 * - 当前激活 session 的 CLI profileId 决定调用哪个 provider。
 * - provider 通过 tauri quota_fetch 通用 HTTP 代理调 CLI 自己的额度 API。
 * - 返回统一的 QuotaSnapshot 结构,UI 不感知 CLI 差异。
 *
 * 5h/7d 窗口结构(对齐 codemoss quota.windows[]):
 * - window.label: 例 "5小时" / "7天"
 * - window.displayPercent: 已用百分比 (0-100)
 * - window.resetsAt: 重置时间 (ms epoch)
 */

/** 窗口长标签 → 短标(QuotaChip 工具栏与 welcome 额度区共用,禁止各写一份)。 */
export const SHORT_WINDOW_LABEL: Record<string, string> = {
  "5小时": "5h",
  "7天": "7d",
  "1天": "1d",
  "30天": "30d",
};

export interface QuotaWindow {
  /** 显示标签: 例 "5小时" / "7天"。 */
  label: string;
  /** 已用百分比 0-100。 */
  displayPercent: number;
  /** 重置时间 ms epoch; 缺省 = 不显示 reset 文本。 */
  resetsAt?: number;
}

export interface QuotaSnapshot {
  /** 供应商显示名: 例 "KIMI" / "Codex" / "Claude"。 */
  providerLabel: string;
  /** 套餐标题: 例 "KIMI 套餐额度" / "Codex 账号额度"。 */
  title: string;
  /** 已用 vs 剩余模式: 当前固定用 "used" (用户截图是 "已使用")。 */
  usedLabel: "已使用" | "已剩余";
  /** 5h 与 7d 窗口。 */
  windows: QuotaWindow[];
  /** 余额型供应商(deepseek/中转站)无窗口,直接给展示文本: 例 "¥12.50"。 */
  balanceText?: string;
  /** 套餐标签: 例 kimi plan_type / zhipu level / 中转站 planName。 */
  planLabel?: string;
  /** 错误信息; 存在则覆盖正常显示。 */
  error?: string;
}

/** 单个 CLI 的 quota 抓取器。 */
interface QuotaProvider {
  /** 对应的 CLI profileId (例 "pi" / "omp" / "codex")。 */
  profileId: string;
  /** 抓取当前 CLI 的 quota。失败时 throw。 */
  fetch: (ctx: QuotaFetchContext) => Promise<QuotaSnapshot>;
}

/** quota 抓取上下文:model 用于多供应商 CLI(omp/pi)按模型前缀路由供应商。 */
export interface QuotaFetchContext {
  /** 当前会话模型(例 "kimi-code/k3");可能尚未识别。 */
  model?: string | null;
}

const providers = new Map<string, QuotaProvider>();

export function registerQuotaProvider(p: QuotaProvider): void {
  providers.set(p.profileId, p);
}

export function getQuotaProvider(profileId: string): QuotaProvider | null {
  return providers.get(profileId) ?? null;
}