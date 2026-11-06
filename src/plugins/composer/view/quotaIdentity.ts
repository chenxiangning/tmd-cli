/** QuotaChip 抓取身份解析(纯逻辑,出组件文件以满足 only-export-components)。
 *  回归钉背景(2026-11-06 实证截图):composer 裸挂 <QuotaChip /> 时 React 恒
 *  传 {},真值判空被空对象骗过 —— 4d4cd116(v0.5.0)起 chip 恒拿 null 模型,
 *  omp 路由报「未识别当前模型,无法路由供应商」;按字段回退活跃会话推导。 */

/** 额度数据源覆写(结构化会话工具条复用):不传 = 活跃 PTY 会话推导(原语义);
 *  传入 profileId = 按给定身份抓取(RPC tab 无活跃 PTY 会话)。 */
export interface QuotaChipSource {
  profileId: string;
  model?: string | null;
  cwd?: string;
  cliSessionId?: string;
}

export function resolveQuotaIdentity(
  source: Partial<QuotaChipSource> | undefined,
  sessionId: string | null | undefined,
  session: { engine?: string; profileId?: string; cwd?: string } | null | undefined,
  statusModel: string | null | undefined,
  sessionCliId: string | undefined,
): { profileId?: string; model: string | null; cwd?: string; cliSessionId?: string } {
  return {
    profileId: source?.profileId ?? session?.engine ?? session?.profileId,
    model: source?.model ?? (sessionId ? (statusModel ?? null) : null),
    cwd: source?.cwd ?? session?.cwd,
    cliSessionId: source?.cliSessionId ?? (sessionId ? sessionCliId : undefined),
  };
}
