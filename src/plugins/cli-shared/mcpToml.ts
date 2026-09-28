/**
 * MCP 配置 TOML 家编解码基元 —— mcpWrite.ts 的 `[mcp_servers.*]` 读写底座
 * (codex ~/.codex/config.toml · grok ~/.grok/config.toml)。准入与先例声明
 * 见 mcpWrite.ts 头注(六 cli-* + mcp-hub 联合消费,同一格式域)。不引 TOML 库(grokConfig 同先例):
 * - 段扫描:任意 `[` 段头 = 段界;`[mcp_servers.x]` 主段与 `.env` 等子表段
 *   都算 x 的名下段(磁盘实证子表可与无关段交错);带引号段名支持。
 * - 值解码:双引号转义串/单引号字面串/布尔/数字/数组/内联表/裸 token
 *   (日期等按原样字符串);多行数组按括号配平吞行;坏行抛错。
 * - 值编码:标量/字符串数组/内联表(嵌套内联表合法,递归);函数等非法
 *   形状抛错拒写;引号/反斜杠/控制字符全转义。
 */

/** 一台 MCP server 的原生配置形状(各家方言透传;不造统一抽象)。 */
export type McpServerEntry = Record<string, unknown>;

/** `[mcp_servers.<...>]` 段头(含子表,如 `.env`;允许带引号段名与行尾注释)。 */
const SEGMENT_HEADER = /^\s*\[\s*mcp_servers\.(.+?)\s*\]\s*(?:#.*)?$/;
/** 任意段头行(`[`/`[[` 开头)= 段界。 */
const ANY_HEADER = /^\s*\[/;

/** 拆段名首键:`x.env` → { name: "x", rest: ".env" };"a.b" → 引号名 + rest;
 *  引号未闭合 = null(不算 mcp_servers 段)。 */
function splitHeaderPath(inner: string): { name: string; rest: string } | null {
  if (inner.startsWith('"')) {
    let name = "";
    let i = 1;
    for (; i < inner.length; i++) {
      const c = inner[i];
      if (c === "\\") {
        name += inner[i + 1] ?? "";
        i++;
        continue;
      }
      if (c === '"') break;
      name += c;
    }
    if (i >= inner.length) return null;
    const rest = inner.slice(i + 1);
    if (rest && !rest.startsWith(".")) return null;
    return { name, rest };
  }
  const dot = inner.indexOf(".");
  if (dot < 0) return { name: inner.trim(), rest: "" };
  return { name: inner.slice(0, dot).trim(), rest: inner.slice(dot) };
}

interface TomlSegment {
  name: string;
  rest: string;
  /** 段头行号(含)。 */
  start: number;
  /** 段界(不含;下一个段头行或 EOF)。 */
  end: number;
}

/** 扫全部 `[mcp_servers.*]` 段(主段与子表段;可与无关段交错,以磁盘实证)。 */
export function scanSegments(text: string): TomlSegment[] {
  const lines = text.split("\n");
  const out: TomlSegment[] = [];
  let cur: TomlSegment | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (ANY_HEADER.test(lines[i])) {
      if (cur) {
        cur.end = i;
        out.push(cur);
        cur = null;
      }
      const m = lines[i].match(SEGMENT_HEADER);
      const p = m && splitHeaderPath(m[1]);
      if (p) cur = { name: p.name, rest: p.rest, start: i, end: lines.length };
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** 删除时把段尾空行一并吸收进段界(目标区内清理,不碰段外字节)。 */
export function absorbTrailingBlanks(lines: string[], seg: TomlSegment): TomlSegment {
  let end = seg.end;
  while (end < lines.length && lines[end].trim() === "" && end > seg.start + 1) end++;
  return { ...seg, end };
}

/** 管理键先行(常见形状稳定序),其余键按条目原序跟随(如 startup_timeout_sec)。 */
const MANAGED_ORDER = ["command", "args", "env", "cwd", "url", "headers"];

/** 序列化一节 `[mcp_servers.<name>]`(env/headers 用内联表形状)。 */
export function serializeTomlServer(name: string, entry: McpServerEntry): string {
  const keys = [
    ...MANAGED_ORDER.filter((k) => entry[k] !== undefined),
    ...Object.keys(entry).filter((k) => !MANAGED_ORDER.includes(k)),
  ];
  const head = `[mcp_servers.${tomlKey(name)}]`;
  if (keys.length === 0) return head;
  return `${head}\n${keys.map((k) => `${tomlKey(k)} = ${tomlValue(entry[k], k)}`).join("\n")}`;
}

/** 值序列化:字符串/数字/布尔/数组/内联表(递归);函数等非法形状抛错拒写。 */
function tomlValue(v: unknown, where: string): string {
  if (typeof v === "string") return tomlString(v);
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return `[${v.map((x) => tomlValue(x, where)).join(", ")}]`;
  if (v && typeof v === "object") {
    const inner = Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${tomlKey(k)} = ${tomlValue(x, where)}`)
      .join(", ");
    return inner ? `{ ${inner} }` : "{}";
  }
  throw new Error(`不可序列化的 ${where} 值(${String(v)});已拒写`);
}

/** TOML basic string:引号/反斜杠/控制字符转义。 */
function tomlString(s: string): string {
  let out = '"';
  for (const ch of s) {
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch < " " || ch === "") out += `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;
    else out += ch;
  }
  return `${out}"`;
}

/** 裸键合法则裸写,否则引号键(TOML 裸键字符集 A-Za-z0-9_-)。 */
function tomlKey(k: string): string {
  return /^[A-Za-z0-9_-]+$/.test(k) ? k : tomlString(k);
}

/** 读侧全文入口:解析全部 `[mcp_servers.*]` 为原生形状条目表(子表
 *  `.env` 等挂嵌套对象;codex 磁盘实证子表可与无关段交错)。无法解析抛错。 */
export function parseTomlMcpServers(text: string): Record<string, McpServerEntry> {
  const lines = text.split("\n");
  const out: Record<string, McpServerEntry> = {};
  for (const seg of scanSegments(text)) {
    const entry = (out[seg.name] ??= {});
    const body = parseSegmentBody(lines.slice(seg.start + 1, seg.end));
    if (seg.rest === "") {
      Object.assign(entry, body);
      continue;
    }
    const path = seg.rest.slice(1).split(".").map(unquoteKey);
    let cur: McpServerEntry = entry;
    for (const p of path.slice(0, -1)) cur = (cur[p] ??= {}) as McpServerEntry;
    const last = path[path.length - 1];
    Object.assign((cur[last] ??= {}) as McpServerEntry, body);
  }
  return out;
}

/** 键名去引号(裸键原样;引号键解一层反斜杠)。 */
function unquoteKey(k: string): string {
  if (k.startsWith('"') && k.endsWith('"') && k.length >= 2) {
    return k.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  return k;
}

/** 去行尾注释(尊重引号内的 #)。 */
function stripComment(line: string): string {
  let inStr: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'") inStr = c;
    else if (c === "#") return line.slice(0, i);
  }
  return line;
}

/** 段体键值解析;多行数组/内联表按括号配平吞行;空行跳过;坏行抛错。 */
function parseSegmentBody(lines: string[]): McpServerEntry {
  const entry: McpServerEntry = {};
  let i = 0;
  while (i < lines.length) {
    const stripped = stripComment(lines[i]).trim();
    i++;
    if (!stripped) continue;
    const eq = stripped.indexOf("=");
    if (eq < 0) throw new Error(`无法解析的配置行:${stripped}`);
    const key = unquoteKey(stripped.slice(0, eq).trim());
    let valueText = stripped.slice(eq + 1).trim();
    while (!bracketsBalanced(valueText) && i < lines.length) {
      valueText += ` ${stripComment(lines[i]).trim()}`;
      i++;
    }
    entry[key] = parseTomlValue(valueText);
  }
  return entry;
}

/** 括号配平(尊重引号;未闭合 = false,吞行续读)。 */
function bracketsBalanced(s: string): boolean {
  let depth = 0;
  let inStr: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") inStr = c;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") {
      depth--;
      if (depth < 0) return true;
    }
  }
  return depth === 0;
}

/** 解析单值:字符串(双引号转义/单引号字面)/布尔/数字/数组/内联表/裸 token。 */
function parseTomlValue(raw: string): unknown {
  const s = raw.trim();
  if (!s) throw new Error("空值");
  if (s.startsWith('"""') || s.startsWith("'''")) throw new Error("多行字符串不受支持");
  if (s.startsWith('"')) return parseBasicString(s);
  if (s.startsWith("'")) {
    const end = s.indexOf("'", 1);
    if (end < 0) throw new Error("字符串未闭合");
    return s.slice(1, end);
  }
  if (s === "true" || s === "false") return s === "true";
  if (/^-?[\d_]/.test(s) && /^[-+\d_.eE]+$/.test(s)) {
    const n = Number(s.replace(/_/g, ""));
    if (Number.isFinite(n)) return n; // 形如日期的裸 token(2024-11-05)NaN → 落回原样
  }
  if (s.startsWith("[") && s.endsWith("]")) {
    return splitTopLevel(s.slice(1, -1)).map((part) => parseTomlValue(part));
  }
  if (s.startsWith("{") && s.endsWith("}")) {
    const out: McpServerEntry = {};
    for (const part of splitTopLevel(s.slice(1, -1))) {
      const eq = part.indexOf("=");
      if (eq < 0) throw new Error(`内联表键值对无等号:${part.trim()}`);
      out[unquoteKey(part.slice(0, eq).trim())] = parseTomlValue(part.slice(eq + 1));
    }
    return out;
  }
  if (s.startsWith("[") || s.startsWith("{")) throw new Error("多行值未配平");
  return s;
}

/** 双引号 basic string:解转义(含 \uXXXX)。 */
function parseBasicString(s: string): string {
  const ESC: Record<string, string> = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\", b: "\b", f: "\f" };
  let out = "";
  for (let i = 1; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") {
      const n = s[i + 1];
      if (n === "u") {
        const hex = s.slice(i + 2, i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error("非法 \\u 转义");
        out += String.fromCharCode(parseInt(hex, 16));
        i += 5;
        continue;
      }
      if (!(n in ESC)) throw new Error(`未知转义 \\${n}`);
      out += ESC[n];
      i++;
      continue;
    }
    if (c === '"') return out;
    out += c;
  }
  throw new Error("字符串未闭合");
}

/** 按顶层逗号切(尊重引号与嵌套括号);滤空段(尾逗号合法)。 */
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inStr: string | null = null;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") inStr = c;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}
