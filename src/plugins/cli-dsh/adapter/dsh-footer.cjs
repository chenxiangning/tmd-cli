/**
 * 底栏 footer —— 空闲时幕布最后一行的常驻信息条(仿 pi/omp footer)。
 * 段:`<glyph> › <model> › <cwd> › ⑂ <branch>[ *dirty] › <ctx 条>`。
 * 上下文条按 pct 画实心块 + `pct% used/window`。dsh 无成本字段,诚实省略 $。
 * git 分支本机 shell 采集(通用能力,非 dsh 私有);失败留空不阻断。
 */

const { execFile } = require("child_process");
const os = require("os");

function shortenPath(p) {
  const home = os.homedir();
  return p && p.startsWith(home) ? "~" + p.slice(home.length) : p || "";
}

/** git 分支 + 脏计数(异步,失败 resolve null)。 */
function gitInfo(cwd) {
  return new Promise((resolve) => {
    if (!cwd) return resolve(null);
    execFile("git", ["-C", cwd, "branch", "--show-current"], (e, br) => {
      if (e) return resolve(null);
      execFile("git", ["-C", cwd, "status", "--porcelain"], (e2, st) => {
        const n = e2 ? 0 : st.split("\n").filter(Boolean).length;
        resolve({ branch: br.trim(), dirty: n });
      });
    });
  });
}

/** ctx 条:`───32%─── 14.9k/1M`(实心块按 pct,占满剩余宽)。 */
function ctxBar(T, used, window, avail) {
  if (!window) return "";
  const pct = Math.min(100, Math.round((used / window) * 100));
  const label = `${pct}% ${T.formatTokens(used)}/${T.formatTokens(window)}`;
  const barLen = Math.max(4, Math.min(avail, 24));
  const fill = Math.round((pct / 100) * barLen);
  const bar = "█".repeat(fill) + "░".repeat(barLen - fill);
  const col = pct > 85 ? "error" : pct > 60 ? "warning" : "accent";
  return T.fg("dim", " ") + T.fg(col, bar) + T.fg("dim", " " + label);
}

/** 组装 footer 行(不含换行)。 */
function buildFooter(T, render, info) {
  const seg = [];
  if (info.model) seg.push(T.fg("accent", "● " + info.model));
  if (info.cwd) seg.push(T.fg("dim", shortenPath(info.cwd)));
  if (info.branch) {
    const d = info.dirty ? T.fg("warning", ` ${info.dirty}`) : "";
    seg.push(T.fg("success", "⑂ " + info.branch) + d);
  }
  const left = seg.join(T.fg("muted", "  ›  "));
  const ctx = ctxBar(T, info.ctxUsed, info.ctxWindow, Math.max(0, (info.cols || 100) - render.displayWidth(left)));
  return left + (ctx ? T.fg("muted", "  › ") + ctx : "");
}

module.exports = { buildFooter, gitInfo };
