/**
 * en 词典 · market 域 —— 插件市场页动态键(plugin.meta 的 name/desc/abbr 经
 * t(variable) 渲染,静态扫描不可见;市场页会列出未激活插件,自带词典未注册,
 * 故落 kernel 词典)。键 = 中文源串,与 plugin meta 定义处逐字一致。
 */
export const MESSAGES = {
  /* academy */
  "CLI 学堂": "CLI Academy",
  "多 CLI 引导学习:斜杠命令指南、入门课与练习,课程由各引擎插件供给":
    "Guided onboarding for multiple CLIs: slash-command guide, starter courses, and exercises; courses come from each engine plugin",
  /* session-relay */
  "跨引擎接力": "Cross-engine handoff",
  "把当前会话的进度带到另一个引擎的新会话,撞墙不停摆":
    "Carries the current session's progress into a fresh session on another engine — hit a wall, keep going",
  /* session-search */
  "会话检索": "Session search",
  "按你输入过的内容检索本工作区的历史会话,一键续聊":
    "Search this workspace's past sessions by what you typed; resume any of them in one click",
  /* session-viewer */
  "会话查看器": "Session viewer",
  "会话列表 view icon 打开只读转录;画布浮层切活会话结构化视图,幕布保活":
    "Opens a read-only transcript from the session list's view icon; an overlay switches the live session to a structured view while the terminal keeps running",
  /* session-board(abbr;name/desc 已在 settings 域) */
  "看板": "Board",
} as Record<string, string>;
