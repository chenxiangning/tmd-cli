/**
 * omp/pi 渲染风格复刻 —— 逐条取自 pi 源码(规格表 local://dsh-render-spec.md):
 * - 工具块 = 满宽背景带(tool-execution.ts Box(1,1)),无框线;
 *   pending #282832 → success #283228 / error #3c2828 换色。
 * - 标题行 formatXxxCall:read/write/edit `名 <path>`(bold 名+accent 路径)、
 *   bash `$ cmd`、grep `grep /pat/ in path`。
 * - 结果预览行数:read/write 10、bash 5、grep 15、find/ls 20;
 *   超出 `... (N more lines, M total)` muted。
 * - bash 完成叠 `Took X.Xs` muted(formatDuration 同款)。
 * - spinner:⠋⠹⠸⠴⠦⠧⠇⠏ 80ms accent + muted "Working..."(loader.ts)。
 */

const T = require("./dsh-theme.cjs");

const FILE_TOOLS = new Set(["read", "write", "edit", "multiedit", "strreplace", "notebookedit"]);
const PREVIEW_LINES = { bash: 5, grep: 15, find: 20, glob: 20, ls: 20 };
const DEFAULT_PREVIEW = 10;

function parseArgs(rawArgs) {
  if (rawArgs == null) return {};
  if (typeof rawArgs === "object") return rawArgs;
  try { return JSON.parse(String(rawArgs)) || {}; } catch { return {}; }
}

/** 显示宽度:CJK/全角字符终端占 2 列(宽度算错会让 band 换行、重绘 erase 错位)。 */
const WIDE_RE = /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;
function displayWidth(s) {
  let w = 0;
  for (const ch of s) w += WIDE_RE.test(ch) ? 2 : 1;
  return w;
}
function termWidth() { return process.stdout.columns || 100; }

/** 满宽背景带行(omp Box(1,1) 语义:左右 1 空格 padding,铺满终端宽)。
 *  styledLine 先截到 cols-4 防超宽换行错位(长路径标题实证风险)。 */
function band(bgName, styledLine) {
  const tw = termWidth();
  const line = fitWidth(styledLine, Math.max(4, tw - 3));
  const visible = displayWidth(plainOf(line)) + 2;
  const pad = " ".repeat(Math.max(0, tw - visible));
  return T.bg(bgName, ` ${T.ESC}[0m${line}${T.ESC}[0m ` + pad);
}

/* ── 标题行(formatXxxCall 同款)───────────────────────────────────────────── */

function toolTitleLine(name, rawArgs) {
  const a = parseArgs(rawArgs);
  const fp = a.file_path || a.path || a.notebook_path || null;
  if (name === "bash") {
    const cmd = typeof a.command === "string" ? a.command : null;
    const timeout = typeof a.timeout === "number" ? T.fg("muted", ` (timeout ${a.timeout}s)`) : "";
    const disp = cmd == null ? T.fg("error", "[invalid command]") : cmd ? cmd : T.fg("muted", "...");
    return T.bold(T.fg("text", `$ ${disp}`)) + timeout;
  }
  if (name === "grep") {
    let line = T.bold(T.fg("text", "grep")) + " " + T.fg("accent", `/${a.pattern ?? ""}/`);
    if (a.path) line += T.fg("muted", ` in ${a.path}`);
    if (a.glob) line += T.fg("muted", ` (${a.glob})`);
    return line;
  }
  if (name === "find" || name === "glob") {
    let line = T.bold(T.fg("text", name)) + " " + T.fg("accent", String(a.pattern ?? ""));
    if (a.path) line += T.fg("muted", ` in ${a.path}`);
    return line;
  }
  if (name === "ls") return T.bold(T.fg("text", "ls")) + " " + T.fg("accent", String(a.path || "."));
  if (FILE_TOOLS.has(name)) {
    let line = T.bold(T.fg("text", name)) + " " + T.fg("accent", fp ?? "?");
    if (name === "read" && (a.offset != null || a.limit != null)) {
      line += T.fg("muted", ` (${a.offset ?? 1}-${(a.offset ?? 1) + (a.limit ?? 2000)})`);
    }
    return line;
  }
  if (name === "task" || name === "agent" || name === "todo" || name === "todowrite") {
    const desc = a.description || a.prompt || "";
    return T.bold(T.fg("text", name)) + (desc ? " " + T.fg("muted", clip(String(desc), 80)) : "");
  }
  const summary = fp || a.command || a.pattern || a.query || "";
  return T.bold(T.fg("text", name)) + (summary ? " " + T.fg("accent", clip(String(summary), 80)) : "");
}

/* ── 结果体 ──────────────────────────────────────────────────────────────── */

/** diff 行着色:+绿 -红(omp diff.ts 简化到单色级)。 */
function colorDiff(line) {
  if (line.startsWith("+") && !line.startsWith("+++")) return T.fg("success", line);
  if (line.startsWith("-") && !line.startsWith("---")) return T.fg("error", line);
  return line;
}

/** 结果预览行数组(按工具限行数 + muted 截断提示)。 */
function toolResultLines(name, output, isError) {
  const text = (typeof output === "string" ? output : safeStringify(output) || "").trim();
  if (!text) return [];
  const lines = text.split("\n");
  const max = PREVIEW_LINES[name] ?? DEFAULT_PREVIEW;
  const shown = lines.slice(0, max);
  const out = shown.map((l) => (isError ? T.fg("error", l) : T.fg("muted", colorDiff(l))));
  if (lines.length > max) {
    out.push(T.fg("muted", `... (${lines.length - max} more lines, ${lines.length} total)`));
  }
  return out;
}

/* ── todo 列表 ───────────────────────────────────────────────────────────── */

const TODO_MARKS = { completed: ["✓", "success"], in_progress: ["▸", "warning"], pending: ["○", "muted"] };

function todoLines(rawArgs, output) {
  const pick = (v) => (Array.isArray(parseArgs(v).todos) ? parseArgs(v).todos : null);
  const todos = pick(rawArgs) || pick(output);
  if (!todos) return null;
  return todos.map((t) => {
    const [mark, color] = TODO_MARKS[t.status] || TODO_MARKS.pending;
    const txt = t.activeForm || t.content || "";
    const body = t.status === "completed" ? T.fg("muted", clip(String(txt), 100)) : T.fg("text", clip(String(txt), 100));
    return `  ${T.fg(color, mark)} ${body}`;
  });
}

/* ── spinner / 消息 ──────────────────────────────────────────────────────── */

const SPINNER_FRAMES = ["\u280b", "\u2819", "\u2839", "\u2838", "\u283c", "\u2834", "\u2826", "\u2827", "\u2807", "\u280f"];
const SPINNER_INTERVAL_MS = 80;

function spinnerFrame(i) { return T.fg("accent", SPINNER_FRAMES[i % SPINNER_FRAMES.length]); }

/** 轮次统计:Took 1.2s(formatDuration 同款)。 */
function tookLine(ms) { return T.fg("muted", `Took ${(ms / 1000).toFixed(1)}s`); }

/** 用户消息独立卡片:◆ 图标 + accent「用户」标签 + 边框线 + userBg 正文带。
 *  全行(含正文带)精确 ≤ cols-1 —— band 默认铺满 cols 会触发 deferred-wrap
 *  错位(截图「用/户」断两行根因),这里用卡宽 w 自铺。长文按显示宽折行。 */
function userCardLines(text) {
  const w = Math.max(8, termWidth() - 1);
  const cardBand = (t) => {
    const inner = ` ${T.ESC}[0m${T.fg("text", t)}${T.ESC}[0m `;
    const pad = " ".repeat(Math.max(0, w - displayWidth(t) - 2));
    return T.bg("userBg", inner + pad);
  };
  const icon = T.fg("accent", "◆");
  const label = T.fg("accent", T.bold(" 用户 "));
  const lines = [icon + label + T.fg("dim", "─".repeat(Math.max(0, w - displayWidth(plainOf(icon + label)))))];
  let cur = "";
  let curW = 0;
  for (const ch of String(text).replace(/\r?\n/g, " ")) {
    const cw = displayWidth(ch);
    if (curW + cw > w - 2) { lines.push(cardBand(cur)); cur = ""; curW = 0; }
    cur += ch;
    curW += cw;
  }
  if (cur) lines.push(cardBand(cur));
  lines.push(icon + T.fg("dim", "─".repeat(w - 1)));
  return lines.map((l) => fitWidth(l, w));
}

function thinkingLine(text) { return T.italic(T.fg("muted", text)); }

/* ── 模型列表(model-selector 同款)────────────────────────────────────────── */

/** 模型列表:omp model-selector 同款(→ accent + [group] muted + ✓ success)。
    catalog 线格式 = llm.models value.groups(codemoss flatten_llm_models 同款)。 */
function modelListLines(groups, currentModel) {
  const out = [];
  for (const g of groups || []) {
    if (!g || !Array.isArray(g.models) || g.models.length === 0) continue;
    const provider = g.id || "unknown";
    out.push(T.fg("dim", `  ${g.name || provider}`));
    for (const m of g.models) {
      const id = m?.id;
      if (!id) continue;
      const full = `${provider}/${id}`;
      const isCur = currentModel === full || m.default === true;
      const label = m.name && m.name !== id ? `${id} (${m.name})` : id;
      out.push(isCur
        ? `    ${T.fg("accent", `→ ${label}`)}${T.fg("success", " ✓")}`
        : `      ${T.fg("text", label)}`);
    }
  }
  return out;
}

function clip(s, n) { return s.length > n ? s.slice(0, n) + "…" : s; }
const plainOf = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

/** ANSI 感知的显示宽度截断:超宽裁到 cols-1 + `…`(控制序列不计宽)。 */
function fitWidth(s, cols) {
  if (cols <= 0 || displayWidth(s.replace(/\x1b\[[0-9;]*m/g, "")) <= cols) return s;
  let w = 0;
  const out = [];
  const re = /\x1b\[[0-9;]*m|[\s\S]/gu;
  let m;
  while ((m = re.exec(s)) !== null) {
    const tok = m[0];
    if (tok.startsWith("\x1b")) { out.push(tok); continue; }
    const cw = displayWidth(tok);
    if (w + cw > cols - 1) { out.push("…"); break; }
    w += cw;
    out.push(tok);
  }
  return out.join("") + "\x1b[0m";
}
function safeStringify(v) { try { return JSON.stringify(v, null, 2); } catch { return String(v); } }
function errMsgSafe(e) { return typeof e === "string" ? e : e?.message || JSON.stringify(e); }

module.exports = {
  toolTitleLine, toolResultLines, todoLines, band,
  spinnerFrame, SPINNER_INTERVAL_MS, tookLine, userCardLines, thinkingLine, modelListLines, clip, errMsgSafe, displayWidth, fitWidth,
};
