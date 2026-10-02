/** ja 词典 · cli-omp 域(键 = 中文源串;zh 恒等无词典)。
 *  既存 omp 词条暂留 kernel/locales/{en,ja}/cli.ts(已知债务,迁移另案);
 *  本插件词典只收新词条,同键后到覆盖。 */
export const MESSAGES_JA = {
  // ── 供应商认证/自定义供应商空态(统一 Empty 形制)──
  "没有可用供应商": "利用できるプロバイダーがありません",
  "还没有自定义供应商": "カスタムプロバイダーはまだありません",
} as Record<string, string>;
