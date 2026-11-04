/**
 * 工具行元数据纯函数 —— 对照 codemoss ProcessDisclosure 的分类思想:
 * 工具名/命令归类为类型键(组件侧翻文案 chip),目标路径提炼为文件 chip。
 * 纯函数无 React 依赖,契约测试直测。
 */
import type { CliTranscriptBlock } from "@kernel/cli";
import { toolRowLabel } from "@plugins/session-viewer/transcriptPhases";

/** 工具类型键(组件侧映射文案;稳定枚举,勿改拼写)。 */
export type SsToolTypeKey = "web" | "shell" | "read" | "edit" | "search" | "task" | "tool";

/** 工具调用归类:工具名或 shell 命令文本 → 类型键(codemoss toolTypeKey 同规则)。 */
export function toolTypeKey(text: string): SsToolTypeKey {
  const tokens = text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const tokenSet = new Set(tokens);
  const has = (...names: string[]) => names.some((n) => tokenSet.has(n));
  if (has("web_search", "websearch", "web", "fetch", "browse")) return "web";
  if (has("bash", "sh", "shell", "zsh", "terminal", "run_command")) return "shell";
  if (has("read", "cat", "view", "read_file", "open_file")) return "read";
  if (has("write", "edit", "write_file", "edit_file", "apply_patch", "patch", "sed")) return "edit";
  if (has("grep", "glob", "rg", "find", "ls", "search", "search_files")) return "search";
  if (has("task", "agent", "spawn")) return "task";
  /* 多词标签 = 引擎给出的 shell 命令(codemoss 判据);下划线分词,
   * spawn_agent → spawn + agent 能命中 task 类。 */
  if (tokens.length > 1 || text.includes(" ")) return "shell";
  return "tool";
}

/**
 * 目标路径 → 文件 chip 尾名;glob 模式、URL、空路径不给 chip —— 模式不是可打开的
 * 文件,URL 末段(如 artifact://0 的 "0")渲染成文件夹 chip 无意义(codemoss 同规则)。
 * 读选择器(`file.ts:301-591:raw`、`img.svg:img`)的尾部 `:段` 是读取修饰,剥掉;
 * Windows 盘符 `C:` 存活(其后不是纯数字段)。
 */
export function fileChipFor(path: string | null | undefined): string | null {
  if (!path || /[*?{}[\]]/.test(path) || path.includes("://")) return null;
  /* 读选择器尾段分两步剥:先关键字(:raw/:img)再行号段(:301-591);
   * Windows 盘符 `C:` 在串首、两步都锚 $,不受影响。 */
  const cleaned = path.replace(/:[a-z]+$/, "").replace(/(:\d+(-\d+)?)+$/, "");
  const trimmed = cleaned.replace(/[/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const base = idx < 0 ? trimmed : trimmed.slice(idx + 1);
  return base ? base : null;
}

/** 工具行渲染元数据一次算齐(组件瘦身,complexity 出件)。 */
export function toolRowMeta(block: CliTranscriptBlock): {
  status: string;
  running: boolean;
  label: string;
  typeKey: SsToolTypeKey;
  chip: string | null;
  cmdPreview: string | null;
  detail: string | null;
} {
  const status = block.tool?.status ?? "running";
  const running = status === "running";
  const preview = block.tool?.preview;
  const detail = block.tool?.detail?.trim();
  return {
    status,
    running,
    label: toolRowLabel(block),
    typeKey: toolTypeKey(block.tool?.title ?? preview?.output ?? ""),
    chip: fileChipFor(preview?.path),
    cmdPreview: preview?.output?.trim() ? preview.output : null,
    detail: detail ? detail : null,
  };
}
