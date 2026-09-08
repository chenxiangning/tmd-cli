/**
 * codemoss 数据导入 —— 三源:
 * 1. ~/.ccgui/agent.json:智能体合并(名称撞车加 " (2)" 后缀换新 id;selected 不迁);
 * 2. ~/.codex/prompts/*.md:codemoss 全局提示词(与 codex 旧目录共享),撞名跳过;
 * 3. 「从目录导入…」:任意 md 平铺目录(codemoss 工作区级在其 app-data 内,
 *    bundleId 不可知,由用户 pickDirectory 自选兜底),撞名跳过。
 *
 * 提示词文件格式与 tmd 私有库同构(frontmatter description/argument-hint),
 * 解析直接走 promptMd;导入结果返回计数供设置页行内反馈。
 */

import { ipc } from "@kernel/ipc";
import { parsePromptFile } from "./promptMd";
import { agentByName, saveAgent, savePrompt, sanitizePromptName } from "./store";

export interface ImportReport {
  agents: number;
  prompts: number;
  skipped: number;
}

function emptyReport(): ImportReport {
  return { agents: 0, prompts: 0, skipped: 0 };
}

/** 名称撞车时递加 " (N)" 后缀,直到不撞(N 从 2 起,中文括号习惯同 macOS 副本)。 */
function uniqueAgentName(name: string): string {
  if (!agentByName(name)) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name} (${n})`;
    if (!agentByName(candidate)) return candidate;
  }
}

export async function importCodemossAgents(): Promise<ImportReport> {
  const report = emptyReport();
  const home = await ipc.configHomeDir();
  const raw = await ipc.fsReadFile(`${home}/.ccgui/agent.json`).catch(() => "");
  if (!raw) return report;
  let parsed: { agents?: Record<string, { name?: unknown; prompt?: unknown; icon?: unknown }> };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return report;
  }
  for (const entry of Object.values(parsed.agents ?? {})) {
    if (typeof entry?.name !== "string" || !entry.name.trim()) {
      report.skipped++;
      continue;
    }
    const saved = await saveAgent({
      name: uniqueAgentName(entry.name.trim()),
      icon: typeof entry.icon === "string" ? entry.icon : undefined,
      prompt: typeof entry.prompt === "string" ? entry.prompt : "",
    });
    if (saved) report.agents++;
    else report.skipped++;
  }
  return report;
}

/** codemoss 全局提示词目录(~/.codex/prompts)。 */
export async function importCodemossPrompts(): Promise<ImportReport> {
  const home = await ipc.configHomeDir();
  return importPromptDir(`${home}/.codex/prompts`);
}

/** 任意 md 平铺目录 → 全局库;撞名 / 空文件 / 子目录跳过。 */
export async function importPromptDir(dir: string): Promise<ImportReport> {
  const report = emptyReport();
  const entries = await ipc.fsWalkFiles(dir, 2000).catch(() => [] as string[]);
  for (const entry of entries) {
    if (entry.includes("/") || !entry.endsWith(".md")) continue;
    const name = sanitizePromptName(entry.slice(0, -".md".length));
    if (!name) {
      report.skipped++;
      continue;
    }
    const text = await ipc.fsReadFile(`${dir}/${entry}`).catch(() => "");
    if (!text.trim()) {
      report.skipped++;
      continue;
    }
    const saved = await savePrompt("global", undefined, { name, ...parsePromptFile(text) });
    if (saved) report.prompts++;
    else report.skipped++;
  }
  return report;
}
