/**
 * session-budget 域词典(插件自带,i18n.registerMessages 注册)。
 * 键 = 中文源串;zh 恒等无词典。
 */
import { registerMessages } from "@kernel/i18n";

/** en 词典 · session-budget 域。 */
const MESSAGES_EN = {
  "会话列表显示预算": "Session List Budget",
  "关闭": "Close",
  "显示总数": "Total rows",
  "一个工作区内所有 CLI 分组共享的初始露出条数({min}–{max},默认 {def})。已分配 {allocated} 条,剩余 {remaining} 条由未配置的 CLI 均分。「更多...」仍可按需翻倍加载。":
    "Initial rows shared by all CLI groups in a workspace ({min}–{max}, default {def}). {allocated} allocated; the remaining {remaining} are split evenly among unconfigured CLIs. \"More...\" still loads double on demand.",
  "{name} 配额": "{name} quota",
  "固定预留的条数;留空 = 均分剩余(当前约 {share} 条),0 = 初始不露出历史。":
    "Fixed reserved rows; empty = even share of the rest (about {share} now), 0 = show no history initially.",
  "总数须为 {min}–{max} 的整数。": "Total must be an integer between {min} and {max}.",
  "总数不能小于已分配配额之和({n}),请先下调分类配额。":
    "Total cannot be smaller than the sum of allocated quotas ({n}); lower the per-CLI quotas first.",
  "配额须为 0–{max} 的整数(分类之和不超过总数)。":
    "Quota must be an integer between 0 and {max} (sum of quotas cannot exceed the total).",
} as const;

/** ja 词典 · session-budget 域。 */
const MESSAGES_JA = {
  "会话列表显示预算": "セッションリスト表示予算",
  "关闭": "閉じる",
  "显示总数": "合計表示数",
  "一个工作区内所有 CLI 分组共享的初始露出条数({min}–{max},默认 {def})。已分配 {allocated} 条,剩余 {remaining} 条由未配置的 CLI 均分。「更多...」仍可按需翻倍加载。":
    "ワークスペース内の全 CLI グループで共有する初期表示行数({min}–{max}、既定 {def})。割り当て済み {allocated} 行、残り {remaining} 行は未設定の CLI で均等分割。「もっと見る...」で必要に応じて倍増読み込みできます。",
  "{name} 配额": "{name} の割り当て",
  "固定预留的条数;留空 = 均分剩余(当前约 {share} 条),0 = 初始不露出历史。":
    "固定確保行数。空欄 = 残りを均等分配(現在約 {share} 行)、0 = 履歴を初期表示しない。",
  "总数须为 {min}–{max} 的整数。": "合計は {min}〜{max} の整数で指定してください。",
  "总数不能小于已分配配额之和({n}),请先下调分类配额。":
    "合計は割り当て済みクォータの合計({n})より小さくできません。先に各 CLI の割り当てを下げてください。",
  "配额须为 0–{max} 的整数(分类之和不超过总数)。":
    "クォータは 0〜{max} の整数で指定してください(割り当ての合計は総数を超えられません)。",
} as const;

registerMessages({ en: MESSAGES_EN, ja: MESSAGES_JA });
