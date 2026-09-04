/**
 * Markdown frontmatter 最小解析 ── SKILL.md / commands/*.md 扫描共用
 * (skillDirs / mdCommands 消费;CLI 私有知识进 cli-shared 的惯例同 grokConfig)。
 *
 * 各 CLI(claude/qoder/codex/kimi/grok)的技能与命令定义都是
 * `---` 包围的 YAML 头 + markdown 正文,这里只取单行 `key: value` 形态的
 * name/description/argument-hint —— 与各家解析器的公共交集:
 * - 值两侧引号剥掉(YAML 允许,claude 实证 open-spec/new.md 有引号值);
 * - 数组/多行值(`allowed-tools:` 换行列表等)不解析,消费方用不到;
 * - 解析失败有权威回落(claude 二进制文档明示):name 回落文件/目录名,
 *   description 回落正文首个非空行 —— 这里同样提供 firstBodyLine。
 */

export interface FrontmatterResult {
  /** 单行 key: value 形态的字段(引号已剥)。 */
  fields: Record<string, string>;
  /** 剥掉 frontmatter 后首个非空行(escription 回落源)。 */
  firstBodyLine: string;
}

/** 解析 frontmatter;无 `---` 头或头残缺时返回空 fields + 首非空行。 */
export function parseFrontmatter(text: string): FrontmatterResult {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") {
    return { fields: {}, firstBodyLine: firstNonEmpty(lines) };
  }
  const fields: Record<string, string> = {};
  let bodyStart = lines.length;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "---") {
      bodyStart = i + 1;
      break;
    }
    const m = line.match(/^([A-Za-z][\w-]*)[ \t]*:[ \t]*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (value.length >= 2 && ((value[0] === '"' && value.endsWith('"')) || (value[0] === "'" && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    fields[m[1]] = value;
  }
  return { fields, firstBodyLine: firstNonEmpty(lines.slice(bodyStart)) };
}

function firstNonEmpty(lines: string[]): string {
  for (const line of lines) {
    const t = line.trim();
    if (t) return t;
  }
  return "";
}

/** 约定字段读取:描述 = frontmatter description,缺省回落正文首行(各家同款回落)。 */
export function frontmatterDescription(text: string): string | undefined {
  const { fields, firstBodyLine } = parseFrontmatter(text);
  return fields.description || firstBodyLine || undefined;
}
