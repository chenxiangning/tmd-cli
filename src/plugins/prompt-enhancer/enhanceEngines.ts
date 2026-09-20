/**
 * 增强提示词引擎面 —— 8 家 CLI 一次性 print 模式的 spawn/流式收割/归档收口。
 *
 * 链路(v2,2026-09-21):session_spawn 起 PTY 跑一次性改写 → pty://out 实时喂
 * 面板(进度+内容,ANSI 剥离)→ 结束后读落盘日志全量,按 <ENHANCED> 哨兵提取终稿
 * (TTY 下进度行/stderr 合流/CLI 插件噪声都在哨兵外,天然隔离;哨兵缺失回退全量
 * 清洗文本)→ sessionKill 收尾,磁盘身份经 profile.listSessions 定位后
 * archiveSession 直进归档(增强会话不占默认视图)。
 *
 * argv 实证(2026-09-21 逐家 --help):claude/qoder/omp/pi `-p`、codex `exec`、
 * opencode `run`、kimi/grok `-p <值>`;模型旗标 claude/omp/pi 用 `--model`,其余 `-m`。
 * TTY 形态实测(script -q):omp -p 输出 Working... 进度行 + 答案 + 插件噪声行,
 * 哨兵可整段隔离。CLI 私有知识只落本文件;PTY 走 session_spawn 通用原语。
 */

import { ipc, onPtyExit, onPtyOutput } from "@kernel/ipc";
import { host } from "@kernel/host";
import { stripAnsi } from "@kernel/askDetect";
import { archiveSession, sessionArchiveKey } from "@kernel/sessionArchive";

export interface EnhanceEngineAdapter {
  id: string;
  command: string;
  buildArgs(prompt: string, model: string | null): string[];
}

function modelArgs(flag: string, model: string | null): string[] {
  const m = model?.trim();
  return m ? [flag, m] : [];
}

export const ENHANCE_ENGINES: EnhanceEngineAdapter[] = [
  { id: "claude", command: "claude", buildArgs: (p, m) => ["-p", p, ...modelArgs("--model", m)] },
  /* codex:非 git 目录被信任闸拒绝(2026-09-21 实证);增强只改写提示词,跳过检查兼容任意工作区 */
  { id: "codex", command: "codex", buildArgs: (p, m) => ["exec", "--skip-git-repo-check", ...modelArgs("-m", m), p] },
  { id: "omp", command: "omp", buildArgs: (p, m) => ["-p", ...modelArgs("--model", m), p] },
  { id: "pi", command: "pi", buildArgs: (p, m) => ["-p", ...modelArgs("--model", m), p] },
  { id: "opencode", command: "opencode", buildArgs: (p, m) => ["run", ...modelArgs("-m", m), p] },
  { id: "kimi", command: "kimi", buildArgs: (p, m) => ["-p", ...modelArgs("-m", m), p] },
  { id: "qoder", command: "qoder", buildArgs: (p, m) => ["-p", ...modelArgs("-m", m), p] },
  /* grok 的 -p = --single <PROMPT> 取值型,值必须紧跟其后再接模型旗标(2026-09-21 --help 实证) */
  { id: "grok", command: "grok", buildArgs: (p, m) => ["--single", p, ...modelArgs("-m", m)] },
];

export type EnhancePreset = "light" | "structured" | "executable";

const PRESET_RULES: Record<EnhancePreset, string> = {
  light: "- 只整理措辞与清晰度,短句不扩写;草稿已清晰时仅做轻度润色。",
  structured: "- 用简洁小节重组(如 目标/背景/约束/输出/验收),仅在有帮助时分节。",
  executable: "- 最多输出 6 行短句,纯文本;删除填充词与元语言,只保留可执行的约束与交付格式。",
};

/** 终稿哨兵:模型把改写结果包在标记内,TTY 噪声(进度行/stderr 合流)留在标记外。 */
const ENHANCE_MARKER_OPEN = "<ENHANCED>";
const ENHANCE_MARKER_CLOSE = "</ENHANCED>";

/** 组装一次改写的完整指令(base + 档位约束 + 哨兵规则 + 草稿);指令要求保留草稿原语言。 */
export function buildEnhanceInstruction(draft: string, preset: EnhancePreset): string {
  return [
    "你是一名提示词改写助手。",
    "把用户的草稿改写为更清晰、更可执行的 AI 助手提示词。",
    "要求:",
    "- 保留原始意图、语言和明确事实。",
    "- 不要回答请求本身。",
    "- 草稿含糊时,在不虚构新事实的前提下改善结构与清晰度。",
    PRESET_RULES[preset],
    `- 把改写结果完整包在 ${ENHANCE_MARKER_OPEN} 与 ${ENHANCE_MARKER_CLOSE} 标记之间,标记之外不要输出任何内容(不要解释、不要代码围栏)。`,
    "",
    "用户草稿:",
    draft,
  ].join("\n");
}

/** 剥整段 ``` 围栏(指令已禁止但仍偶发);非全围栏形态原样返回。 */
export function stripCodeFence(text: string): string {
  const m = text.match(/^```[^\n]*\n([\s\S]*?)\n?```\s*$/);
  return m ? m[1] : text;
}

/** PTY 原始字节 → 可读文本:ANSI 剥离(kernel askDetect 同一件,OSC8 正文安全)+
 *  裸控制字符清理(kernel 版不管束非转义控制符)+ \r\n/裸 \r 归一 + 压 3+ 空行。 */
export function normalizePtyText(text: string): string {
  return stripAnsi(text)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 全量日志 → 终稿:哨兵内芯优先,缺失回退全量清洗文本(去围栏)。 */
export function extractEnhanced(rawLog: string): string {
  const text = normalizePtyText(rawLog);
  const m = text.match(/<ENHANCED>([\s\S]*?)<\/ENHANCED>/);
  if (m) return stripCodeFence(m[1].trim());
  return stripCodeFence(text);
}

export function clampTimeoutSeconds(v: number): number {
  if (!Number.isFinite(v)) return 60;
  return Math.min(300, Math.max(5, Math.round(v)));
}

export type EnhanceOutcome =
  | { ok: true; text: string }
  | { ok: false; kind: "timeout" | "empty" | "engine"; detail?: string };

export interface EnhanceRunOpts {
  engineId: string;
  draft: string;
  preset: EnhancePreset;
  model: string | null;
  cwd: string;
  workspaceId: string | null;
  timeoutSeconds: number;
  /** 流式回调:每次 PTY 输出后携带累计已清洗文本(进度 + 内容,供面板实时展示)。 */
  onChunk: (liveText: string) => void;
}

/** 起一次 PTY 增强会话并等到终局;结束(含超时杀)后自归档磁盘身份。 */
export async function runEnhance(opts: EnhanceRunOpts): Promise<EnhanceOutcome> {
  const adapter = ENHANCE_ENGINES.find((e) => e.id === opts.engineId);
  if (!adapter) return { ok: false, kind: "engine", detail: `未知引擎 ${opts.engineId}` };
  const startedAt = Date.now();
  let spawned: { id: string };
  try {
    spawned = await ipc.sessionSpawn(
      opts.engineId,
      {
        command: adapter.command,
        args: adapter.buildArgs(buildEnhanceInstruction(opts.draft, opts.preset), opts.model),
        cwd: opts.cwd,
      },
      opts.workspaceId ?? undefined,
    );
  } catch (e) {
    return { ok: false, kind: "engine", detail: String(e).slice(0, 200) };
  }

  const { promise, resolve } = Promise.withResolvers<EnhanceOutcome>();
  let live = "";
  let timedOut = false;
  let settled = false;
  void onPtyOutput(spawned.id, (chunk) => {
    live += chunk;
    opts.onChunk(normalizePtyText(live));
  });
  const timer = setTimeout(() => {
    timedOut = true;
    void ipc.sessionKill(spawned.id).catch(() => {});
  }, clampTimeoutSeconds(opts.timeoutSeconds) * 1000);
  void onPtyExit(spawned.id, () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    void (async () => {
      const outcome = await settle(spawned.id, live, timedOut);
      await cleanup(spawned.id, opts, startedAt);
      resolve(outcome);
    })();
  });
  return promise;
}

/** 终局裁定:流式缓冲为第一权威(订阅与 CLI 冷启动同起,几无丢失);
 *  流为空才退落盘日志(防订阅竞态)——exit 后 PTY 句柄已被 Rust watcher
 *  自清理,sessionLogSize 恒 0,日志读取本就不可依赖(2026-09-21 实证空结果回归)。 */
async function settle(id: string, streamed: string, timedOut: boolean): Promise<EnhanceOutcome> {
  if (timedOut) return { ok: false, kind: "timeout" };
  let full = streamed;
  if (!normalizePtyText(full)) full = await readFullLog(id);
  const live = normalizePtyText(full);
  if (!live) return { ok: false, kind: "empty" };
  if (/command not found/i.test(live)) {
    return { ok: false, kind: "engine", detail: live.split("\n").find((l) => /command not found/i.test(l))?.slice(0, 200) };
  }
  const text = extractEnhanced(full);
  if (!text) return { ok: false, kind: "empty" };
  return { ok: true, text };
}

/** 会话落盘日志全量读回(before 语义向前翻页直到起点)。 */
async function readFullLog(id: string): Promise<string> {
  const size = await ipc.sessionLogSize(id).catch(() => 0);
  let before = size;
  const parts: string[] = [];
  for (let guard = 0; guard < 16 && before > 0; guard++) {
    const page = await ipc.sessionHistoryPage(id, before, 262144).catch(() => null);
    if (!page || !page.text) break;
    parts.unshift(page.text);
    before = page.startOffset;
  }
  return parts.join("");
}

/** 收尾:杀掉已退出的会话条目(容错)+ 磁盘身份定位后直进归档。失败静默不扰 UI。 */
async function cleanup(id: string, opts: EnhanceRunOpts, startedAt: number): Promise<void> {
  void ipc.sessionKill(id).catch(() => {});
  try {
    /* CLI 落盘有迟滞(omp 懒 flush),留一拍再扫。 */
    await new Promise((r) => setTimeout(r, 800));
    const disks = (await host.getCliProfile(opts.engineId)?.listSessions?.(opts.cwd)) ?? [];
    const fresh = disks
      .filter((s) => Math.max(s.modifiedAt, s.createdAt ?? 0) >= startedAt)
      .sort((a, b) => b.modifiedAt - a.modifiedAt)[0];
    if (fresh && opts.workspaceId) {
      archiveSession(sessionArchiveKey(opts.workspaceId, opts.engineId, fresh.id));
    }
  } catch {
    /* 归档失败不打扰:会话仍在,用户可手动归档 */
  }
}
