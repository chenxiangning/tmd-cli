/**
 * academy 域词典(插件自带,i18n.registerMessages 注册)。
 * 键 = 中文源串;zh 恒等无词典。课程正文中英对照在课程数据内,不走 t()。
 */
import { registerMessages } from "@kernel/i18n";

/** en 词典 · academy 域。 */
const MESSAGES_EN = {
  "展开学堂": "Expand academy",
  "收起学堂": "Collapse academy",
  "已结业": "Completed",
  "重温入门": "Revisit the course",
  "继续入门": "Continue the course",
  "第 {n} 课 / {total}": "Lesson {n} / {total}",
  "完整指南": "Full guide",
  "全量命令": "All commands",
  "结业速查表": "Cheat sheet",
  "一屏总览": "One-screen overview",
  "重置学习进度": "Reset progress",
  "{title} 入门 · {n} 课": "{title} starter · {n} lessons",
  "「试一试」会把命令填进对话框,关掉课程直接练":
    "“Try it” fills the command into the composer — close the lesson and practice",
  "上一步": "Back",
  "下一步": "Next",
  "完成": "Finish",
  "练习:{p}": "Practice: {p}",
  "全部章节过完。这张卡是每章最常用命令;完整指南在左栏学堂菜单里随时可查。":
    "All chapters covered. This card lists the most-used commands per chapter; the full guide lives in the academy menu in the left sidebar.",
  "结业:速查表与下一步": "Done: cheat sheet & next steps",
  "共 {n} 条命令": "{n} commands",
  "命中 {n} 条": "{n} matches",
  "搜索命令": "Search commands",
  "搜索命令或功能,如 compact / 额度 / 分支": "Search commands or features, e.g. compact / quota / branch",
  "复制命令": "Copy command",
  "已复制": "Copied",
  "在 tmd-cli 里": "in tmd-cli",
  "去学": "Learn",
  "试一试": "Try it",
  "课程未注册(引擎插件未启用或版本过旧)": "Course not registered (engine plugin disabled or too old)",
  "示例 · 场景 / 操作 / 回显 / 预期": "Examples · scenario / input / output / expectation",
  "预期": "Expected",
  "{n} 条": "{n}",
  "先打开任意工作区会话再试(当前页面没有命令输入框)":
    "Open a workspace session first — there's no command input on this page",
  "本课命令属于 {engine} 会话;当前激活的是 {current},切换后再试":
    "This lesson's commands belong to {engine}; the active session is {current} — switch and try again",
  "课程基于 v{source} 提取,当前引擎 v{installed};命令面可能有出入,以引擎自身帮助为准":
    "Course extracted against v{source}; installed engine is v{installed} — commands may differ, trust the engine's own help",
  "课程列表": "Lesson list",
  "{title} 入门课": "{title} starter course",
  /* 入口与课步(2026-10 i18n 收口) */
  "学堂": "Academy",
  "已完成": "Completed",
} as const;

/** ja 词典 · academy 域。 */
const MESSAGES_JA = {
  "展开学堂": "学堂を展開",
  "收起学堂": "学堂を折りたたむ",
  "已结业": "修了済み",
  "重温入门": "入門を復習",
  "继续入门": "入門を続ける",
  "第 {n} 课 / {total}": "第 {n} 課 / {total}",
  "完整指南": "完全ガイド",
  "全量命令": "全コマンド",
  "结业速查表": "修了チートシート",
  "一屏总览": "一画面総覧",
  "重置学习进度": "学習進捗をリセット",
  "{title} 入门 · {n} 课": "{title} 入門 · {n} 課",
  "「试一试」会把命令填进对话框,关掉课程直接练":
    "「試す」でコマンドを入力欄に挿入——課程を閉じてそのまま練習",
  "上一步": "戻る",
  "下一步": "次へ",
  "完成": "完了",
  "练习:{p}": "練習:{p}",
  "全部章节过完。这张卡是每章最常用命令;完整指南在左栏学堂菜单里随时可查。":
    "全章完了。このカードは各章の最頻出コマンド;完全ガイドは左サイドバーの学堂メニューからいつでも。",
  "结业:速查表与下一步": "修了:チートシートと次のステップ",
  "共 {n} 条命令": "全 {n} コマンド",
  "命中 {n} 条": "{n} 件ヒット",
  "搜索命令": "コマンドを検索",
  "搜索命令或功能,如 compact / 额度 / 分支": "コマンドや機能を検索(例:compact / 月額 / ブランチ)",
  "复制命令": "コマンドをコピー",
  "已复制": "コピーしました",
  "在 tmd-cli 里": "tmd-cli で",
  "去学": "学ぶ",
  "试一试": "試す",
  "课程未注册(引擎插件未启用或版本过旧)": "課程未登録(エンジンプラグイン無効かバージョン古い)",
  "示例 · 场景 / 操作 / 回显 / 预期": "例 · シナリオ / 入力 / 出力 / 期待値",
  "预期": "期待値",
  "{n} 条": "{n} 件",
  "先打开任意工作区会话再试(当前页面没有命令输入框)":
    "先にワークスペースのセッションを開いてください——このページにはコマンド入力欄がありません",
  "本课命令属于 {engine} 会话;当前激活的是 {current},切换后再试":
    "この課のコマンドは {engine} セッション用です。現在アクティブなのは {current} のため、切り替えてから試してください",
  "课程基于 v{source} 提取,当前引擎 v{installed};命令面可能有出入,以引擎自身帮助为准":
    "課程は v{source} から抽出、現在のエンジンは v{installed}。コマンド面が異なる可能性があるため、エンジン自身のヘルプを優先してください",
  "课程列表": "課程リスト",
  "{title} 入门课": "{title} 入門課程",
  /* 入口与课步(2026-10 i18n 收口) */
  "学堂": "学堂",
  "已完成": "完了",
} as const;

registerMessages({ en: MESSAGES_EN, ja: MESSAGES_JA });
