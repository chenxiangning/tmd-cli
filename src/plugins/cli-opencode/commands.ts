/**
 * opencode 斜杠命令候选 —— 内置静态表 + 磁盘自定义命令发现。
 *
 * - 内置 17 条实证自官方 TUI 文档(2026-09-05);action 初判:bare 合法
 *   (无必需参数 / 幕布内 picker 接管)→ send,实测校准后回填契约测试;
 *   editor/exit/undo/redo 取 insert:分别依赖 $EDITOR、误触即关会话、
 *   直接作用于上一条消息,误触代价高。
 * - 自定义命令:全局 ~/.config/opencode/commands/ + 项目 .opencode/commands/,
 *   根级 .md 文件名即命令名(官方文档);子目录命名空间未文档化,不扫(宁可漏报不可误报)。
 * - 同名自定义覆盖内置(官方语义)。
 */
import { ipc } from "@kernel/ipc";
/* 经 cli-shared 消费 opencode 磁盘布局(合法通道,准入先例见其文件头)。 */
import { opencodeConfigDir } from "../cli-shared/opencodeDisk";
import { frontmatterDescription } from "../cli-shared/frontmatter";
import type { CliSuggestion } from "@kernel/cli";
import { opencodeJsonCommandSuggestions, readOpencodeConfig } from "./config";

/** 内置斜杠命令(官方 TUI 文档全量表)。 */
export const OPENCODE_COMMAND_SUGGESTIONS: CliSuggestion[] = [
  { value: "new", description: "新建会话(别名 /clear)", action: "send", icon: "compact" },
  { value: "sessions", description: "列出并切换会话(别名 /resume /continue)", action: "send", icon: "resume" },
  { value: "models", description: "列出可用模型(幕布内 picker)", action: "send", icon: "model" },
  { value: "compact", description: "压缩会话上下文(别名 /summarize)", action: "send", icon: "compact" },
  { value: "undo", description: "撤销上一条消息及其文件改动(需 Git 仓库)", action: "insert" },
  { value: "redo", description: "重做一次撤销(需 Git 仓库)", action: "insert" },
  { value: "share", description: "分享当前会话", action: "send" },
  { value: "init", description: "引导生成/更新 AGENTS.md", action: "send", icon: "plan" },
  { value: "unshare", description: "停止分享当前会话", action: "send" },
  { value: "connect", description: "连接供应商并配置 API key(幕布内 picker)", action: "send", icon: "server" },
  { value: "export", description: "导出会话为 Markdown 并打开编辑器", action: "send" },
  { value: "editor", description: "用 $EDITOR 编辑长消息", action: "insert" },
  { value: "thinking", description: "切换思考/推理块可见性", action: "send", icon: "think" },
  { value: "details", description: "切换工具执行详情", action: "send" },
  { value: "themes", description: "列出主题(幕布内 picker)", action: "send" },
  { value: "help", description: "帮助", action: "send", icon: "help" },
  { value: "exit", description: "退出 opencode(别名 /quit /q)", action: "insert" },
];

/** 合并自定义与内置(纯函数,可测):同名自定义覆盖内置,内置兜底在尾。 */
export function mergeOpencodeSuggestions(
  custom: readonly CliSuggestion[],
  builtin: readonly CliSuggestion[],
): CliSuggestion[] {
  const byValue = new Map<string, CliSuggestion>();
  for (const item of builtin) byValue.set(item.value, item);
  for (const item of custom) byValue.set(item.value, item);
  return [...byValue.values()];
}

/** 自定义命令目录扫描:根级 .md,文件名(去扩展)即命令名;目录读取失败 = 跳过。 */
async function scanCommandMdDir(dir: string): Promise<CliSuggestion[]> {
  const entries = await ipc.fsWalkFiles(dir, 500).catch(() => [] as string[]);
  const out: CliSuggestion[] = [];
  for (const entry of entries) {
    if (entry.includes("/") || !entry.endsWith(".md")) continue;
    const value = entry.slice(0, -".md".length);
    if (!value) continue;
    const text = await ipc.fsReadFile(`${dir}/${entry}`).catch(() => "");
    out.push({
      value,
      description: text ? frontmatterDescription(text) : undefined,
      action: "insert",
    });
  }
  return out;
}

/** 全局自定义命令目录(cli-shared 磁盘布局 + /commands)。 */
async function globalCommandsDir(): Promise<string | null> {
  const dir = await opencodeConfigDir();
  return dir ? `${dir}/commands` : null;
}

/**
 * 运行时命令发现(listSuggestions 数据源):md 扫描 + JSON 命令 + 内置兜底。
 * 配置读取失败 = null(调用方回退静态表);扫描为空仍返回内置表。
 */
export async function listOpencodeSuggestions(
  cwd: string,
): Promise<CliSuggestion[] | null> {
  const [globalDir, config] = await Promise.all([
    globalCommandsDir(),
    readOpencodeConfig(cwd).catch(() => null),
  ]);
  const projectDir = `${cwd.replace(/\/$/, "")}/.opencode/commands`;
  const scanned = await Promise.all([
    globalDir ? scanCommandMdDir(globalDir) : Promise.resolve([] as CliSuggestion[]),
    scanCommandMdDir(projectDir),
  ]).catch(() => null);
  if (!scanned) return null;
  /* 项目同名覆盖全局(扫描序即优先级,merge 首到先得语义反向:后到覆盖)。 */
  const custom = [...scanned[1], ...scanned[0], ...opencodeJsonCommandSuggestions(config)];
  const byValue = new Map<string, CliSuggestion>();
  for (const item of custom) byValue.set(item.value, item);
  return mergeOpencodeSuggestions([...byValue.values()], OPENCODE_COMMAND_SUGGESTIONS);
}
