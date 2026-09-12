/**
 * YAML 行级补丁原语(kernel 通用工具,非 CLI 私有知识)—— 只认
 * 「2 空格缩进 + key: value + `- item` 列表」的常见子集,按路径定位块后
 * 只改目标行,其余字节(注释/未知段/引号风格)原样保留;被改写行上的
 * 行内注释随行保留。
 *
 * 准入:cli-omp 配置 GUI 消费(读某键 + 写回某键且不毁文件);
 * 解析失败不做兜底(调用方显错误态)。第二家 YAML 消费出现即归此层。
 */

const indentOf = (line: string): number => line.match(/^ */)?.[0].length ?? 0;

/** 注释/空行不算块成员,但块内遇到时继续向下走。 */
const isFiller = (line: string): boolean => /^\s*(#|$)/.test(line);

/** 在 [from,to) 内找 indent 层级的 `key:` 行号;找不到 -1。 */
function findKey(lines: string[], from: number, to: number, indent: number, key: string): number {
  const re = new RegExp(`^ {${indent}}${key}:( |$|#)`);
  for (let i = from; i < to; i++) if (re.test(lines[i])) return i;
  return -1;
}

/** header 行之后、缩进更深的连续区域 = 块体 [from,to);to 收敛到最后一个真成员行之后。 */
function blockRange(lines: string[], header: number): { from: number; to: number } {
  const ind = indentOf(lines[header]);
  let to = header + 1;
  let lastMember = header; // 块尾以最后的深缩进成员为准(尾部空行/注释归外层)
  while (to < lines.length) {
    const l = lines[to];
    if (isFiller(l) || indentOf(l) > ind) {
      if (!isFiller(l)) lastMember = to;
      to++;
    } else break;
  }
  return { from: header + 1, to: lastMember + 1 };
}

/** 沿 path 逐级定位;返回末键行与其自身块体范围(逐级 blockRange 收窄)。 */
function locate(lines: string[], path: string[]): { header: number; from: number; to: number } | null {
  let from = 0;
  let to = lines.length;
  let header = -1;
  for (let d = 0; d < path.length; d++) {
    const hit = findKey(lines, from, to, d * 2, path[d]);
    if (hit < 0) return null;
    header = hit;
    ({ from, to } = blockRange(lines, hit));
  }
  return { header, from, to };
}

/** 引号态感知:把行拆成 [值部分, 行内注释(含 #)]。引号内的 # 不算注释。 */
function splitInlineComment(line: string): [string, string] {
  let sq = false;
  let dq = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !dq) sq = !sq;
    else if (c === '"' && !sq) dq = !dq;
    else if (c === "#" && i > 0 && !sq && !dq && (line[i - 1] === " " || line[i - 1] === "\t")) {
      return [line.slice(0, i).trimEnd(), line.slice(i).trim()];
    }
  }
  return [line.trimEnd(), ""];
}

/** 去行内注释 + 剥引号。 */
export function unquoteScalar(raw: string): string {
  const [content] = splitInlineComment(raw.trim());
  let v = content;
  if (v.length > 1 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    v = v.slice(1, -1);
  }
  return v;
}

/** header 行 `key:` 之后的裸值(未剥引号;无值 = "")。 */
function rawValue(lines: string[], header: number): string {
  return lines[header].slice(lines[header].indexOf(":") + 1).trim();
}

/** YAML 标量 → 字符串(布尔/数字统一字符串;缺省/无值 → "")。 */
export function getScalar(lines: string[], path: string[]): string {
  const hit = locate(lines, path);
  if (!hit) return "";
  return unquoteScalar(rawValue(lines, hit.header));
}

/** 块的直接标量子项 [key, value](列表/非子项行忽略)。 */
export function getMap(lines: string[], path: string[]): Array<[string, string]> {
  const hit = locate(lines, path);
  if (!hit) return [];
  const out: Array<[string, string]> = [];
  for (let i = hit.from; i < hit.to; i++) {
    const l = lines[i];
    if (isFiller(l) || indentOf(l) !== path.length * 2 || l.trimStart().startsWith("- ")) continue;
    const m = l.match(/^(\s*)([^:#\s][^:]*):\s*(.*)$/);
    if (m) out.push([m[2].trim(), unquoteScalar(m[3])]);
  }
  return out;
}

/** 块的 `- item` 标量列表;无块行时认 flow `[a, b]` 内联写法。 */
export function getList(lines: string[], path: string[]): string[] {
  const hit = locate(lines, path);
  if (!hit) return [];
  const items: string[] = [];
  for (let i = hit.from; i < hit.to; i++) {
    const m = lines[i].match(/^\s*-\s+(.+)$/);
    if (m) items.push(unquoteScalar(m[1]));
  }
  if (items.length === 0) {
    const inline = getScalar(lines, path).match(/^\[(.*)\]$/);
    if (inline) return inline[1].split(",").map((s) => unquoteScalar(s)).filter((s) => s !== "");
  }
  return items;
}

/** 标量输出格式:布尔裸写;歧义串/含注释与映射特征的串加引号;其余裸写。 */
function fmtScalar(v: string | boolean): string {
  if (typeof v === "boolean") return v ? "true" : "false";
  if (/^(off|on|yes|no|true|false|null|~)$/i.test(v) || v === "") return JSON.stringify(v);
  if (/( #|: )/.test(v) || /^[!&*\]{}>|%"'@`]/.test(v)) return JSON.stringify(v);
  return v;
}

/** 拼值 + 原行内注释(注释始终贴在同一键上)。 */
function withComment(rendered: string, comment: string): string {
  return comment ? `${rendered} ${comment}` : rendered;
}

/** 写 path 末键 = 标量(存在则换行并保留行内注释,缺失则在父块尾/文件尾插行)。 */
export function setScalar(lines: string[], path: string[], value: string | boolean): string[] {
  const out = [...lines];
  const key = path[path.length - 1];
  const hit = locate(out, path);
  if (hit) {
    const r = blockRange(out, hit.header);
    const [, comment] = splitInlineComment(out[hit.header]);
    out.splice(
      hit.header,
      r.to - hit.header,
      withComment(`${" ".repeat((path.length - 1) * 2)}${key}: ${fmtScalar(value)}`, comment),
    );
    return out;
  }
  return insertLeaf(out, path, `${key}: ${fmtScalar(value)}`);
}

/** 写 path 块 = 标量映射(entries = 期望全量:同名原位替换、缺失键追加、多余键删除;
 *  flow `{a: b}` 头整行转块写法;注释与行内注释保留)。 */
export function setMap(lines: string[], path: string[], entries: Array<[string, string]>): string[] {
  const out = [...lines];
  const hit = locate(out, path);
  const ind = path.length * 2;
  if (!hit) {
    return insertLeaf(
      out,
      path,
      `${path[path.length - 1]}:`,
      ...entries.map(([k, v]) => `${k}: ${fmtScalar(v)}`),
    );
  }
  const { header } = hit;
  if (/^\{.*\}$/.test(rawValue(out, header))) {
    out.splice(
      header,
      1,
      `${" ".repeat((path.length - 1) * 2)}${path[path.length - 1]}:`,
      ...entries.map(([k, v]) => `${" ".repeat(ind)}${k}: ${fmtScalar(v)}`),
    );
    return out;
  }
  const { from, to } = blockRange(out, header);
  const wanted = new Map(entries);
  const seen = new Set<string>();
  const rebuilt: string[] = [];
  let i = from;
  while (i < to) {
    const l = out[i];
    if (isFiller(l)) {
      rebuilt.push(l);
      i++;
      continue;
    }
    const key = indentOf(l) === ind ? l.match(/^ *([^:#\s][^:]*):/)?.[1] : undefined;
    const end = key ? blockRange(out, i).to : i + 1;
    if (key && !seen.has(key)) {
      seen.add(key);
      if (wanted.has(key)) {
        const [, comment] = splitInlineComment(l);
        rebuilt.push(withComment(`${" ".repeat(ind)}${key}: ${fmtScalar(wanted.get(key)!)}`, comment));
      }
      // 不在期望集 → 整单元删除
    }
    i = end;
  }
  for (const [k, v] of entries) {
    if (seen.has(k)) continue;
    rebuilt.push(`${" ".repeat(ind)}${k}: ${fmtScalar(v)}`);
    seen.add(k);
  }
  out.splice(from, to - from, ...rebuilt);
  return out;
}

/** 写 path 块 = 标量列表(期望全量;flow 内联原样保持 flow;注释保留;无块则新建)。 */
export function setList(lines: string[], path: string[], items: string[]): string[] {
  const out = [...lines];
  const hit = locate(out, path);
  if (!hit) {
    return insertLeaf(
      out,
      path,
      `${path[path.length - 1]}: `,
      ...items.map((v) => `- ${fmtScalar(v)}`),
    );
  }
  const { header, from, to } = hit;
  const [, comment] = splitInlineComment(out[header]);
  const ind = " ".repeat(path.length * 2);
  const key = path[path.length - 1];
  const pad = " ".repeat((path.length - 1) * 2);
  const inline = rawValue(out, header);
  if (/^\[.*\]$/.test(inline)) {
    // flow 写法保持 flow:`key: [a, b]`
    out.splice(header, 1, withComment(`${pad}${key}: [${items.map(fmtScalar).join(", ")}]`, comment));
    return out;
  }
  if (inline) {
    out.splice(header, 1, `${pad}${key}:`, ...items.map((v) => `${ind}- ${fmtScalar(v)}`));
    return out;
  }
  const kept = out.slice(from, to).filter((l) => !/^\s*-/.test(l) && !/^(\s*)([^:#\s][^:]*):/.test(l));
  out.splice(from, to - from, ...items.map((v) => `${ind}- ${fmtScalar(v)}`), ...kept);
  return out;
}

/** 末键缺失时的插入:找最深现存祖先,在其块尾补 `key:` 链与 body 行。
 *  head 与 body 一律不带缩进,缩进由本函数按层补齐。 */
function insertLeaf(lines: string[], path: string[], head: string, ...body: string[]): string[] {
  const out = [...lines];
  let depth = path.length - 1;
  let insertAt = out.length;
  while (depth > 0) {
    const hit = locate(out, path.slice(0, depth));
    if (hit) {
      insertAt = blockRange(out, hit.header).to;
      break;
    }
    depth--;
  }
  const missing = path.slice(depth);
  const add: string[] = [];
  missing.forEach((k, i) => {
    const pad = " ".repeat((depth + i) * 2);
    add.push(i === missing.length - 1 ? `${pad}${head}` : `${pad}${k}:`);
  });
  const bodyPad = " ".repeat((depth + missing.length) * 2);
  for (const b of body) add.push(bodyPad + b.trimStart());
  out.splice(insertAt, 0, ...add);
  return out;
}
