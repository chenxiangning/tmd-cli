/**
 * Markdown frontmatter 最小解析(通用原语,同 yamlBlocks 先例;零 CLI 语义)。
 * 消费:cli-shared skillDirs/mdCommands(技能与命令扫描)、cli-opencode
 * commands、assets/promptMd(prompt 模板)。
 *
 * 各 CLI(claude/qoder/codex/kimi/grok)的技能与命令定义都是
 * `---` 包围的 YAML 头 + markdown 正文,这里只取 `key: value` 形态的
 * name/description/argument-hint —— 与各家解析器的公共交集:
 * - 值两侧引号剥掉(YAML 允许,claude 实证 open-spec/new.md 有引号值);
 * - 块标量(`>` 折叠 / `|` 字面,含 chomping/indent 指示符)取后续缩进行,
 *   折叠规则:段内换行并空格,空行成段界;字面保留换行(answer-me-with-html
 *   等 claude 官方示例用 `>-` 多行 description,不解析则描述显示 ">-");
 * - 其余多行值(`allowed-tools:` 换行列表等)不解析,消费方用不到;
 * - 解析失败有权威回落(claude 二进制文档明示):name 回落文件/目录名,
 *   description 回落正文首个非空行 —— 这里同样提供 firstBodyLine。
 */

interface FrontmatterResult {
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
    if (/^[>|][+-]?\d*$/.test(value)) {
      const [block, next] = readBlockScalar(lines, i, value[0] === ">", line.match(/^[ \t]*/)?.[0].length ?? 0);
      value = block;
      i = next - 1;
    }
    fields[m[1]] = value;
  }
  return { fields, firstBodyLine: firstNonEmpty(lines.slice(bodyStart)) };
}

/**
 * 块标量读取:从 key 行 i 的下一行起,取「缩进大于 key 行或空行」的行直到
 * 缩进回退或 frontmatter 结束。折叠(`>`):段内换行并空格,空行成段界;
 * 字面(`|`):保留换行。两侧 chomping/显式缩进数字忽略(裁剪统一 trimEnd)。
 */
function readBlockScalar(lines: readonly string[], keyLine: number, folded: boolean, keyIndent: number): [string, number] {
  const segs: string[][] = [[]];
  let indent: number | null = null;
  let j = keyLine + 1;
  for (; j < lines.length; j++) {
    const line = lines[j];
    if (line.trim() === "---") break;
    if (line.trim() === "") {
      /* 空行 = 段界:折叠语义成段界,字面语义成空行(join 后等价) */
      if (segs[segs.length - 1].length > 0) segs.push([]);
      continue;
    }
    const ind = line.match(/^[ \t]*/)?.[0].length ?? 0;
    if (ind <= keyIndent) break;
    if (indent === null) indent = ind;
    segs[segs.length - 1].push(line.slice(indent));
  }
  const paras = segs
    .map((seg) => seg.join(folded ? " " : "\n").replace(/\s+$/, ""))
    .filter((p) => p.length > 0);
  return [paras.join("\n"), j];
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
