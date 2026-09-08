/**
 * 提示词 md 文件序列化 —— tmd 私有提示词库格式(与 codemoss ~/.codex/prompts 同构,
 * 导入时可直接互读):
 *
 *   ---
 *   description: 一句话描述
 *   argument-hint: 参数占位说明(给用户看,如 "PR 号, 重点")
 *   ---
 *
 *   正文($NAME 大写占位符原样保留,插入后手填)
 *
 * 字段解析复用 cli-shared/frontmatter(通用 YAML-like 单行 key: value 解析,
 * 非 CLI 私有格式知识);正文切片自管(parseFrontmatter 不返回 body)。
 */

import { parseFrontmatter } from "../cli-shared/frontmatter";

export interface PromptData {
  description?: string;
  argumentHint?: string;
  content: string;
}

/** 序列化为 md 文件文本;无元数据时纯正文(frontmatter 整体省略)。 */
export function serializePromptFile(data: PromptData): string {
  /* frontmatter 单行约束:值内换行压成空格(解析器不认多行值) */
  const description = data.description?.replace(/\s*\n\s*/g, " ").trim();
  const argumentHint = data.argumentHint?.replace(/\s*\n\s*/g, " ").trim();
  const lines: string[] = [];
  if (description) lines.push(`description: ${description}`);
  if (argumentHint) lines.push(`argument-hint: ${argumentHint}`);
  if (lines.length === 0) return data.content;
  return `---\n${lines.join("\n")}\n---\n\n${data.content}`;
}

/** 解析 md 文件文本;无 frontmatter = 全文即正文。 */
export function parsePromptFile(text: string): PromptData {
  const { fields } = parseFrontmatter(text);
  return {
    description: fields.description || undefined,
    argumentHint: fields["argument-hint"] || undefined,
    content: stripFrontmatter(text),
  };
}

/** 剥掉 `---` 包围的头,返回正文(头部残缺 = 原文返回,宁可多留不丢字)。 */
function stripFrontmatter(text: string): string {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return text;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      return lines.slice(i + 1).join("\n").replace(/^\s*\n/, "");
    }
  }
  return text;
}

/* ── 文件名(文件名即显示名)── */

/** 剥离版(导入侧):把路径分隔符与控制字符剥掉,trim 后可能为空。 */
export function sanitizePromptName(name: string): string {
  return name.replace(/[/\\\u0000-\u001f]/g, "").trim();
}

/** 校验版(UI 保存路径):非法字符直接拒绝;trim 后非空才合法。 */
export function isValidPromptName(name: string): boolean {
  const n = name.trim();
  return !!n && !/[/\\\u0000-\u001f]/.test(n);
}
