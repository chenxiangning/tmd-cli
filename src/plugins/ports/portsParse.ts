/**
 * ports · 文本解析纯函数 —— 各平台系统工具输出的唯一解析口。
 * 全部无 IO、无 ipc:输入原样文本,输出原始监听行/进程图谱,单测 fixtures 锁形状。
 */

/** 解析出的原始监听行(尚未 enrich 进程信息)。 */
export interface RawListener {
  pid: number | null;
  host: string;
  port: number;
}

/** lsof 命令名里的 \xNN 十六进制转义(空格等)还原。 */
export function decodeLsofName(s: string): string {
  return s.replace(/\\x([0-9a-fA-F]{2})/g, (_, h: string) =>
    String.fromCharCode(parseInt(h, 16)),
  );
}

/** host:port → 主机与端口;支持 *:80、127.0.0.1:80、[::]:80、[fe80::1]:80。 */
export function splitHostPort(name: string): { host: string; port: number } | null {
  const m6 = /^\[(.+)\]:(\d+)$/.exec(name);
  if (m6) return { host: m6[1], port: Number(m6[2]) };
  const idx = name.lastIndexOf(":");
  if (idx < 0) return null;
  const port = Number(name.slice(idx + 1));
  if (!Number.isFinite(port) || port <= 0) return null;
  return { host: name.slice(0, idx), port };
}

/** macOS `lsof -nP -iTCP -sTCP:LISTEN +c0`:剥 `(LISTEN)` 后末列起为 NAME NODE SIZE DEVICE TYPE FD USER PID,命令名含空格归头部。 */
export function parseLsofListeners(text: string): RawListener[] {
  const out: RawListener[] = [];
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("COMMAND")) continue;
    const cleaned = s.replace(/\s*\(LISTEN\)\s*$/, "");
    const tokens = cleaned.split(/\s+/);
    if (tokens.length < 8) continue;
    const pid = Number(tokens[tokens.length - 8]);
    const parsed = splitHostPort(tokens[tokens.length - 1]);
    if (!Number.isFinite(pid) || !parsed) continue;
    out.push({ pid, ...parsed });
  }
  return out;
}

/** Linux `ss -tlnp`:LISTEN 行的 users:(("name",pid=1,fd=x),(...));无 users = 无权限,pid null。 */
export function parseSsListeners(text: string): RawListener[] {
  const out: RawListener[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("LISTEN")) continue;
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 5) continue;
    const parsed = splitHostPort(tokens[3]);
    if (!parsed) continue;
    const pids = [...line.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1]));
    if (pids.length === 0) out.push({ pid: null, ...parsed });
    else for (const pid of pids) out.push({ pid, ...parsed });
  }
  return out;
}

/** netstat:Linux `netstat -tlnp`(tcp/tcp6 … LISTEN pid/name)与 Windows `netstat -ano -p tcp`(TCP … LISTENING pid)双形。 */
export function parseNetstatListeners(text: string, windows: boolean): RawListener[] {
  const out: RawListener[] = [];
  for (const line of text.split("\n")) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 4) continue;
    if (windows) {
      /* TCP local foreign STATE pid:state 在 3,pid 在 4。 */
      if (tokens[0] !== "TCP" || tokens[3] !== "LISTENING" || tokens.length < 5) continue;
      const parsed = splitHostPort(tokens[1]);
      const pid = Number(tokens[4]);
      if (parsed && Number.isFinite(pid)) out.push({ pid, ...parsed });
    } else {
      if ((tokens[0] !== "tcp" && tokens[0] !== "tcp6") || tokens[5] !== "LISTEN") continue;
      const parsed = splitHostPort(tokens[3]);
      if (!parsed) continue;
      const pidTok = tokens[6];
      const n = pidTok && pidTok !== "-" ? Number(pidTok.split("/")[0]) : NaN;
      out.push({ pid: Number.isFinite(n) && n > 0 ? n : null, ...parsed });
    }
  }
  return out;
}

export interface ProcMeta {
  ppid: number;
  /** 短名(基名);ps 形为空,由消费方取 args 首段。 */
  name: string;
  args: string;
}

/** macOS/Linux `ps -axo pid=,ppid=,args=`:首两列为 pid/ppid,其余整段为命令行。 */
export function parsePsTree(text: string): Map<number, ProcMeta> {
  const map = new Map<number, ProcMeta>();
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    map.set(Number(m[1]), { ppid: Number(m[2]), name: "", args: m[3] });
  }
  return map;
}

/**
 * Windows `Get-CimInstance … ConvertTo-Csv`:带引号 CSV 行拆分(引号内逗号/双写转义)。
 * # ponytail: 按行解析,命令行内嵌换行的进程名会断行——现实命令行几乎不出现,出现则该行丢弃。
 */
export function parsePowershellProcs(text: string): Map<number, ProcMeta> {
  const map = new Map<number, ProcMeta>();
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return map;
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const iPid = header.indexOf("processid");
  const iPpid = header.indexOf("parentprocessid");
  const iName = header.indexOf("name");
  const iCmd = header.indexOf("commandline");
  if (iPid < 0 || iPpid < 0 || iName < 0) return map;
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const pid = Number(cols[iPid]);
    if (!Number.isFinite(pid)) continue;
    map.set(pid, {
      ppid: Number(cols[iPpid]) || 0,
      name: cols[iName] ?? "",
      args: (iCmd >= 0 ? cols[iCmd] : "") ?? "",
    });
  }
  return map;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** macOS `lsof -a -d cwd -Fn -p p1,p2,…`:p<pid>/fcwd/n<path> 块流,pid → cwd。 */
export function parseLsofCwd(text: string): Map<number, string> {
  const map = new Map<number, string>();
  let cur: number | null = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("p")) cur = Number(line.slice(1));
    else if (line.startsWith("n") && cur !== null) map.set(cur, line.slice(1));
  }
  return map;
}

/** sh 批循环输出 `key\tvalue`:cwd readlink / git rev-parse 批量共用(value 空串 = 无结果)。 */
export function parseShBatch(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split("\n")) {
    const idx = line.indexOf("\t");
    if (idx <= 0) continue;
    map.set(line.slice(0, idx), line.slice(idx + 1));
  }
  return map;
}
