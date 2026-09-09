/** en 词典 · assets 域(键 = 中文源串,资产库插件;zh 恒等无词典)。 */
export const MESSAGES = {
  /* index.tsx(插件 meta / 设置卡 / 面板标题) */
  "可复用智能体与提示词资产库(composer !! / ## 消费)":
    "Reusable agent & prompt asset library (consumed via !! / ## in composer)",
  "可复用资产:composer 里 !! 插入提示词正文,## 挂载智能体(发送时尾拼角色块)。":
    "Reusable assets: !! in the composer inserts prompt body; ## attaches an agent (role block appended on send).",
  "智能体 / 提示词": "Agents / Prompts",
  "智能体": "Agents",
  "提示词": "Prompts",

  /* view/AgentTab.tsx / view/AgentBadge.tsx */
  "智能体(##)": "Agents (##)",
  "还没有智能体。新建一个,或从 codemoss 一键导入;composer 里 ## 选中后,发送时会在消息尾拼角色块。":
    "No agents yet. Create one, or import from codemoss in one click; after picking via ## in the composer, a role block is appended on send.",
  "新建智能体": "New agent",
  "从 codemoss 导入": "Import from codemoss",
  "导入中…": "Importing…",
  "编辑智能体": "Edit agent",
  "删除智能体「{name}」?已选中的会话会自动取消。":
    "Delete agent \"{name}\"? Sessions that selected it will be deselected automatically.",
  "名称必填": "Name is required",
  "名称已存在": "Name already exists",
  "同作用域下名称已存在(或名称含非法字符)":
    "Name already exists in this scope (or contains invalid characters)",
  "图标(单个 emoji,可空)": "Icon (single emoji, optional)",
  "如:小张": "e.g. Alex",
  "描述(可空)": "Description (optional)",
  "如:你是产品交互大神,回答先给结论与理由…":
    "e.g. You are a product interaction expert; always answer conclusion-first with reasoning…",
  "角色 prompt(发送时拼在用户消息尾部)": "Role prompt (appended to the user message on send)",
  "导入 {a} 个智能体,跳过 {s} 条": "Imported {a} agents, skipped {s}",
  "导入失败:~/.ccgui/agent.json 不可读": "Import failed: ~/.ccgui/agent.json is unreadable",
  "本会话智能体:发送时在消息尾拼角色块": "Session agent: role block appended to the message on send",
  "{n} 个智能体": "{n} agents",
  "取消智能体": "Deselect agent",

  /* view/PromptTab.tsx */
  "提示词(!!)": "Prompts (!!)",
  "提示词库": "Prompt Library",
  "没有匹配的提示词。新建一个,或从 codemoss / 目录导入;composer 里 !! 选中即把正文插入输入框。":
    "No matching prompts. Create one, or import from codemoss / a folder; picking one via !! in the composer inserts its body into the input.",
  "新建提示词": "New prompt",
  "新建": "New",
  "从目录导入…": "Import from folder…",
  "选择提示词 md 目录": "Choose a prompt .md folder",
  "搜索名称或描述…": "Search name or description…",
  "编辑提示词": "Edit prompt",
  "删除提示词「{name}」?(进废纸篓)": "Delete prompt \"{name}\"? (Moves to Trash)",
  "移到全局": "Move to global",
  "移到工作区": "Move to workspace",
  "作用域": "Scope",
  "工作区(当前活跃工作区)": "Workspace (currently active)",
  "名称(!! 触发时的调用名)": "Name (invoked with !!)",
  "正文($NAME 大写占位符,插入后手填)": "Body ($NAME uppercase placeholder, fill in after inserting)",
  "参数提示(可空,如:PR 号, 重点)": "Argument hint (optional, e.g. PR number, focus)",
  "参数: {hint}": "Args: {hint}",
  "无活跃工作区,无法保存到工作区级": "No active workspace — cannot save to workspace level",
  "导入 {n} 条提示词,跳过 {s} 条": "Imported {n} prompts, skipped {s}",
  "导入失败:~/.codex/prompts 不可读": "Import failed: ~/.codex/prompts is unreadable",
  "导入失败:目录不可读": "Import failed: folder is unreadable",
};
