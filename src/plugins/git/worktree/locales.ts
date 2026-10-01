/**
 * worktree 域词典(插件自带,i18n.registerMessages 注册)。
 * 键 = 中文源串;zh 恒等无词典。既有 worktree 词条历史上落在
 * kernel/locales/<lang>/git.ts,本轮新增文案按插件自带词典纪律随插件走。
 */
import { registerMessages } from "@kernel/i18n";

/** en 词典 · worktree 域(列表加载期反馈,2026-10 审计工单)。 */
const MESSAGES_EN = {
  "读取 worktree 列表…": "Loading worktree list…",
} as const;

/** ja 词典 · worktree 域。 */
const MESSAGES_JA = {
  "读取 worktree 列表…": "worktree 一覧を読み込み中…",
} as const;

registerMessages({ en: MESSAGES_EN, ja: MESSAGES_JA });
