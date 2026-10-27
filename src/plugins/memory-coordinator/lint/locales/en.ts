/** tmd-lint 域 en 词典(tmd-lint 插件自带;键 = 中文源串)。 */
export const MESSAGES_EN = {
  /* ── 面板头 ── */
  "返回列表": "Back to list",
  "读近 30 天对话日志,AI 判定各文件里的规则是否真的生效": "Read local CLI logs (last 30 days); AI judges whether each rule really applies",
  "判定引擎": "Judge engine",
  "模型占位": "model (optional)",
  "体检": "Lint",
  "读本机近 30 天对话日志,AI 逐条判定规则是否生效": "Read local CLI logs from the last 30 days; AI judges each rule's real effectiveness",
  "打开一个工作区后可体检其规则文件": "Open a workspace to lint its rules files",
  /* ── 进度 ── */
  "定目标中…": "Resolving targets…",
  "读对话中…": "Reading conversations…",
  "抽证据中…({n} 条消息)": "Extracting evidence… ({n} messages)",
  "AI 判定中 {d}/{t}": "AI judging {d}/{t}",
  "体检完成": "Lint finished",
  /* ── 汇总与发现 ── */
  "全部": "All",
  "AI 不听": "Ignored by AI",
  "真的在做": "Followed",
  "只是提到": "Mentioned only",
  "没人用": "Unused",
  "说不清": "Inconclusive",
  "判定失败": "Judge failed",
  "已拍板": "Settled",
  "静态发现": "Static findings",
  "两文件打架": "Conflicting files",
  "引用失效": "Broken reference",
  "规则 {n} 条 · 语料 {m} 消息/{c} 会话": "{n} rules · corpus {m} msgs/{c} sessions",
  "该过滤下没有条目": "No entries under this filter",
  /* ── 行内 ── */
  "触达 {n} 条消息/{s} 个会话,最近 {d};纠正 {c} 次;工具级照做 {p} 次":
    "Touched {n} msgs/{s} sessions, last {d}; corrections {c}; tool-level compliance {p}",
  "规则命令": "rule command",
  "纠正原话": "Correction quote",
  "信号词全部超高频,词面证据不可用,判定仅基于以上硬证据":
    "All signal words are too common; word-level evidence unusable — the verdict rests on the hard evidence above",
  "AI 判定": "AI verdict",
  "本条 AI 判定失败,未回落猜测;可重新体检": "AI judgment failed for this rule (no heuristic fallback); re-run to retry",
  "按建议处理": "Apply advice",
  "保持": "Keep",
  "删除": "Delete",
  "归档": "Archive",
  "收口 stub": "Stub it",
  "修路径": "Fix path",
  "打开": "Open",
  "保持并拍板": "Keep & settle",
  "已拍板:此前处理过,不再重复报": "Settled: handled before, not reported again",
  /* ── 动作确认 ── */
  "删除该规则?": "Delete this rule?",
  "将从规则文件删除该行(先备份 .bak-tmdlint)": "The line will be removed from the rules file (backed up as .bak-tmdlint first)",
  "收口为 stub?": "Replace with a stub?",
  "整文件替换为一行声明(先备份 .bak-tmdlint)": "The whole file will be replaced by one declaration line (backed up as .bak-tmdlint first)",
  /* ── 说明 ── */
  "体检 = 读本机各家 CLI 近 30 天对话日志,与规则文件逐条对照;是否生效由 AI 大模型按证据实时语义判断,纠正原话与照做证据随包附上供核对。":
    "Lint = read all local CLI conversation logs from the last 30 days and compare them rule by rule; effectiveness is judged in real time by an AI model against the evidence, with correction quotes and compliance evidence attached for review.",
  "写回前自动备份 .bak-tmdlint;对话日志只读,零上传;判定随引擎与模型而异,建议动作仅供决策参考":
    "Writes are backed up as .bak-tmdlint first; logs are read-only, nothing leaves this machine; verdicts vary by engine and model — advice is for reference only",
} as Record<string, string>;
