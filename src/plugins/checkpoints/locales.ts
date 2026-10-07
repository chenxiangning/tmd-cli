/**
 * checkpoints 域词典(插件自带,i18n.registerMessages 注册)。
 * 键 = 中文源串;zh 恒等无词典。既有 checkpoints 词条历史上落在
 * kernel/locales/<lang>/misc.ts,新增高危计数字段按插件自带词典纪律随插件走。
 */
import { registerMessages } from "@kernel/i18n";

/** en 词典 · checkpoints 域(高危计数汇总 pill,2026-10 审计 P0-3 收口)。 */
const MESSAGES_EN = {
  "{n} 高危": "{n} high-risk",
  "本批含 {n} 个高危文件(凭据/Shell 配置/CI/服务),建议细读 diff 再放行":
    "This batch touches {n} sensitive file(s) (credentials / shell config / CI / services) — read the diff carefully before approving",
  "待审批次共 {n} 个高危文件(凭据/Shell 配置/CI/服务),建议逐批细读 diff":
    "{n} sensitive file(s) across pending batches (credentials / shell config / CI / services) — review each diff before approving",
  /* W2 存证链:批头携带标注计数 pill;
     工作区外文件分区(BatchFileSection / BatchRowParts,2026-10 i18n 收口,
     前像术语沿用 kernel misc 既有译法 pre-batch image) */
  "标 ×{n}": "Marks ×{n}",
  "本轮 prompt 随发携带的标注引用(标记中心可反查改写轮次)":
    "Marks carried by this round's prompt (the marks panel traces which rounds rewrote them)",
  "无前像": "No baseline",
  "工作区外文件,首轮批前像不可知 —— 禁回退(防误删既有文件);次轮起可正常回退":
    "Outside-workspace file: its pre-batch image is unknowable on the first round — revert is disabled (so an existing file is never deleted by mistake); from the second round on it reverts normally",
  "工作区外({n}) —— 首轮批前像不可知,禁回退;次轮起可正常回退":
    "Outside workspace ({n}) — pre-batch image unknown on the first round, revert disabled; reverts normally from the second round on",
} as const;

/** ja 词典 · checkpoints 域。 */
const MESSAGES_JA = {
  "{n} 高危": "{n} 件高リスク",
  "本批含 {n} 个高危文件(凭据/Shell 配置/CI/服务),建议细读 diff 再放行":
    "このバッチは敏感なファイル(認証情報 / シェル設定 / CI / サービス)を {n} 件含みます。承認前に diff を確認してください",
  "待审批次共 {n} 个高危文件(凭据/Shell 配置/CI/服务),建议逐批细读 diff":
    "承認待ちバッチに敏感なファイル(認証情報 / シェル設定 / CI / サービス)が計 {n} 件。各バッチの diff を確認してから承認してください",
  /* 工作区外文件分区(BatchFileSection / BatchRowParts,2026-10 i18n 收口;
     前像术语沿用 kernel misc 既有译法 事前イメージ) */
  "无前像": "事前イメージなし",
  /* W2 存证链:批头携带标注计数 pill */
  "标 ×{n}": "マーク ×{n}",
  "本轮 prompt 随发携带的标注引用(标记中心可反查改写轮次)":
    "このラウンドのプロンプトに添付されたマーク参照(マーク中心から書き換えラウンドを追跡できます)",
  "工作区外文件,首轮批前像不可知 —— 禁回退(防误删既有文件);次轮起可正常回退":
    "ワークスペース外のファイル:初回ラウンドは事前イメージが不明のためロールバック不可(既存ファイルの誤削除を防止)。2 ラウンド目以降は通常どおりロールバックできます",
  "工作区外({n}) —— 首轮批前像不可知,禁回退;次轮起可正常回退":
    "ワークスペース外({n})——初回は事前イメージが不明のためロールバック不可。2 ラウンド目以降は通常どおり",
} as const;

registerMessages({ en: MESSAGES_EN, ja: MESSAGES_JA });
