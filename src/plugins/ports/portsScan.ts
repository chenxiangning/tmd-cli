/**
 * ports · 扫描编排 —— 按平台跑系统工具,解析后 enrich 进程信息/cwd/git 顶层。
 * 全部经 ipc.procCommunicate 通用原语,零 Rust 命令;每步失败进 warnings 不致命。
 */

import { ipc } from "@kernel/ipc";
import { detectOs } from "./platform";
import type { ProcMeta } from "./portsParse";
import {
  decodeLsofName,
  parseLsofCwd,
  parseLsofListeners,
  parseNetstatListeners,
  parsePowershellProcs,
  parsePsTree,
  parseShBatch,
  parseSsListeners,
  type RawListener,
} from "./portsParse";
import { dedupeListeners, exposureOf } from "./portsTree";
import type { PortEntry, ScanOutcome } from "./types";

const TIMEOUT_MS = 8000;

async function run(command: string, args: string[], timeoutMs = TIMEOUT_MS): Promise<string> {
  const r = await ipc.procCommunicate({
    command,
    args,
    cwd: "/",
    timeoutMs,
    closeStdin: true,
  });
  const out = r.stdout ?? "";
  /* 空输出 + 非零退出:lsof「无监听」合法空态(仅 stderr 有话才算失败)。 */
  if (!out.trim() && r.stderr?.trim()) throw new Error(r.stderr.trim());
  return out;
}

/** basename:进程短名 = 命令行首段去路径(Windows 兼容 \ 分隔)。 */
function baseName(first: string): string {
  const seg = first.split(/[\\/]/).pop() ?? first;
  return decodeLsofName(seg);
}

/** 端口+pid 原始行(平台工具应答)→ 去重后的监听行。 */
async function collectListeners(os: "mac" | "linux" | "windows"): Promise<{
  raw: RawListener[];
  source: ScanOutcome["source"];
}> {
  if (os === "windows") {
    return {
      raw: parseNetstatListeners(await run("netstat", ["-ano", "-p", "tcp"]), true),
      source: "netstat",
    };
  }
  return {
    raw: parseLsofListeners(await run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "+c0"])),
    source: "lsof",
  };
}

/** Linux 端口工具:ss 缺失/报错回落 netstat(两者都空 = 真无监听)。 */
async function collectLinuxListeners(): Promise<{ raw: RawListener[]; source: ScanOutcome["source"] }> {
  try {
    const out = await run("ss", ["-tlnp"]);
    return { raw: parseSsListeners(out), source: "ss" };
  } catch {
    const out = await run("netstat", ["-tlnp"]);
    return { raw: parseNetstatListeners(out, false), source: "netstat" };
  }
}

async function collectUnixProcs(): Promise<Map<number, ProcMeta>> {
  return parsePsTree(await run("ps", ["-axo", "pid=,ppid=,args="]));
}

async function collectWindowsProcs(): Promise<Map<number, ProcMeta>> {
  const script =
    "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Csv -NoTypeInformation";
  return parsePowershellProcs(await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], 15000));
}

/** cwd 批读:mac 走 lsof -Fn,linux 走 /proc readlink 批循环;Windows 无公共 API 恒空。键 = pid 字符串。 */
async function collectCwd(pids: number[], os: "mac" | "linux" | "windows"): Promise<Map<string, string>> {
  if (os === "windows" || pids.length === 0) return new Map();
  if (os === "mac") {
    const byPid = parseLsofCwd(await run("lsof", ["-a", "-d", "cwd", "-Fn", "-p", pids.join(",")]));
    const byKey = new Map<string, string>();
    for (const [pid, dir] of byPid) byKey.set(String(pid), dir);
    return byKey;
  }
  const script = 'for p in "$@"; do printf \'%s\\t%s\\n\' "$p" "$(readlink "/proc/$p/cwd" 2>/dev/null)"; done';
  return parseShBatch(await run("sh", ["-c", script, "sh", ...pids.map(String)]));
}

/** cwd → git 顶层批查(仅 mac/linux;一行一 cwd,非仓库 = 空串)。 */
async function collectGitRoots(dirs: string[]): Promise<Map<string, string>> {
  if (dirs.length === 0) return new Map();
  const script =
    'for d in "$@"; do printf \'%s\\t%s\\n\' "$d" "$(git -C "$d" rev-parse --show-toplevel 2>/dev/null)"; done';
  return parseShBatch(await run("sh", ["-c", script, "sh", ...dirs]));
}

export async function scanPorts(osInput?: "mac" | "linux" | "windows"): Promise<ScanOutcome> {
  const os = osInput ?? detectOs();
  const warnings: string[] = [];
  const listened = os === "linux" ? await collectLinuxListeners() : await collectListeners(os);

  let procs = new Map<number, ProcMeta>();
  try {
    procs = os === "windows" ? await collectWindowsProcs() : await collectUnixProcs();
  } catch (e) {
    warnings.push(e instanceof Error ? e.message : String(e));
  }

  const ppidAll = new Map<number, number>();
  for (const [pid, meta] of procs) ppidAll.set(pid, meta.ppid);

  const rows: PortEntry[] = dedupeListeners(
    listened.raw.map((l) => ({
      port: l.port,
      addr: l.host,
      exposure: exposureOf(l.host),
      pid: l.pid,
      process: "",
      args: "",
      ppid: null,
      cwd: null,
      gitRoot: null,
    })),
  );

  for (const row of rows) {
    const meta = row.pid !== null ? procs.get(row.pid) : undefined;
    if (!meta) continue;
    row.ppid = meta.ppid || null;
    row.args = meta.args;
    row.process = meta.name || baseName(meta.args.split(/\s+/)[0] ?? "");
  }

  /* cwd 与 git 顶层:仅对有 pid 的行;git 只查去重后的目录。 */
  const pidRows = rows.filter((r) => r.pid !== null);
  try {
    const cwdMap = await collectCwd(
      pidRows.map((r) => r.pid!),
      os,
    );
    const dirs = [...new Set([...cwdMap.values()].filter(Boolean))];
    const gitMap = await collectGitRoots(dirs);
    for (const row of pidRows) {
      row.cwd = cwdMap.get(String(row.pid)) || null;
      row.gitRoot = (row.cwd && gitMap.get(row.cwd)) || null;
    }
  } catch (e) {
    warnings.push(e instanceof Error ? e.message : String(e));
  }

  return { rows, os, source: listened.source, ppidAll, warnings };
}
