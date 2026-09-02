/**
 * qoder 双分发版共享内核 —— 国际版(qodercli/~/.qoder)与国内版(qoderclicn/~/.qoder-cn)
 * 的同一磁盘格式知识(实证 2026-09-02,本机 qodercli 1.1.33 / qoderclicn 1.1.28)。
 *
 * 会话存储:<dataDir>/projects/<slug>/<uuid>.jsonl,文件名即会话 id(claude 同构布局);
 * jsonl 为 claude fork 行型:用户行 origin.kind=human 判别,assistant 行 message.model 落盘,
 * 错误帧 isApiErrorMessage=true 且 model=<synthetic>;思考强度只在 settings.json,不落会话。
 *
 * 变体差异只有常量(dataDirName/command),由各插件目录自己声明 —— 两分发版分叉时改动局部化。
 */

import { ipc } from "@kernel/ipc";
import { extractJsonlTitle } from "@kernel/diskSessions";
import type { CliDiskSession, CliProfile, CliSessionStatus } from "@kernel/cli";
import { qoderUserMessageLine, readUserMessagesFromFile } from "./userMessages";

/**
 * cwd → projects 子目录 slug。
 * 与 claude 完全同规则(实证 ~/.qoder/projects/-Users-…-github-codemoss ↔
 * /Users/…/github/codemoss,CJK 逐字符替换);独立命名不回改 claude,两 CLI 契约各自演进。
 */
export function qoderProjectSlug(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

/** cwd → 该分发版的会话目录;home 取不到 = null(不猜)。 */
export async function qoderSessionsDir(
  dataDirName: string,
  cwd: string,
): Promise<string | null> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return null;
  return `${home}/${dataDirName}/projects/${qoderProjectSlug(cwd)}`;
}

/** 标题提取的头部窗口:qoder 无 title/summary 记录,首条用户消息前可能有 snapshot 行,给足余量。 */
const QODER_TITLE_HEAD_BYTES = 32 * 1024;

/**
 * `/` 命令候选 —— 全部实证,不猜:前 5 个取自国际版会话文件内 skill_listing 附件
 * (内置 skill,/name 原生语法),feedback 取自错误文案("input /feedback")。
 * 候选只是 composer 补全 UI 提示(纯透传,不进协议);两分发版上游同源,cn 侧无独立
 * 实证,不一致时以实际 CLI 为准。
 */
export const QODER_COMMAND_SUGGESTIONS: CliProfile["suggestions"] = {
  command: [
    { value: "simplify", description: "审查改动代码的复用/质量/效率并修复" },
    { value: "quest", description: "两阶段特性开发:先方案确认再实现" },
    { value: "mcp-config", description: "交互式管理 MCP 服务器配置" },
    { value: "loop", description: "定时循环执行 prompt 或命令" },
    { value: "run", description: "启动并驱动项目应用验证改动" },
    { value: "feedback", description: "提交问题反馈" },
  ],
};
/** 扫描该 cwd 的磁盘历史会话;<uuid>.jsonl 文件名即会话 id,直接喂 --resume。 */
export async function listQoderSessions(
  dataDirName: string,
  cwd: string,
): Promise<CliDiskSession[]> {
  const dir = await qoderSessionsDir(dataDirName, cwd);
  if (!dir) return [];
  const files = await ipc.fsCollectFiles(dir, ".jsonl").catch(() => []);
  const sessions: CliDiskSession[] = [];
  for (const f of files) {
    const m = f.name.match(/^([0-9a-f-]{36})\.jsonl$/);
    if (!m) continue;
    const head = await ipc.fsReadHead(f.path, QODER_TITLE_HEAD_BYTES).catch(() => "");
    const title = head ? extractJsonlTitle(head) : undefined;
    sessions.push({ id: m[1], modifiedAt: f.modifiedAt, path: f.path, title });
  }
  return sessions;
}

const QODER_STATUS_TAIL_BYTES = 256 * 1024;

/**
 * 从会话文件尾部提取当前模型/思考强度(纯函数,可测)。两帧型实证(2026-09-02):
 * - runtime-config 帧:CLI 显式落盘的会话配置,含 model 与 reasoningEffort(可为 null);
 *   部分 model 切换会话只有此帧、零 assistant 帧,漏扫会误报"未识别"。
 * - assistant 帧:message.model 是回复面模型真相;错误帧(isApiErrorMessage=true,
 *   实证 credit 耗尽时 model=<synthetic>)跳过,更早真实模型胜出。
 * 倒序逐帧、逐字段取首个非空观测(omp/pi sessionStatus 同款优先级语义)。
 */
export function extractQoderSessionStatus(
  tail: string,
): CliSessionStatus | null {
  let model: string | undefined;
  let thinkingLevel: string | undefined;
  for (const line of tail.split("\n").reverse()) {
    if (!line.includes('"model"') && !line.includes('"reasoningEffort"')) continue;
    try {
      // 外部 JSON 逐层 in/typeof 收窄,不做 inline cast
      const event: unknown = JSON.parse(line);
      if (!event || typeof event !== "object" || !("type" in event)) continue;
      const frame = event as Record<string, unknown>;
      if (frame.type === "runtime-config") {
        if (!model && typeof frame.model === "string" && frame.model) {
          model = frame.model;
        }
        if (
          !thinkingLevel &&
          typeof frame.reasoningEffort === "string" &&
          frame.reasoningEffort
        ) {
          thinkingLevel = frame.reasoningEffort;
        }
      } else if (frame.type === "assistant" && frame.isApiErrorMessage !== true) {
        const message: unknown = frame.message;
        if (!model && message && typeof message === "object") {
          const frameModel: unknown = (message as Record<string, unknown>).model;
          if (typeof frameModel === "string" && frameModel) model = frameModel;
        }
      }
      if (model && thinkingLevel) break;
    } catch {
      // 尾部块的首行可能被截断,跳过继续读完整行。
    }
  }
  return model || thinkingLevel ? { model, thinkingLevel } : null;
}

/** 会话态状态观测:tail 扫 runtime-config/assistant 帧,纯函数收尾。 */
export async function readQoderSessionStatus(
  dataDirName: string,
  cwd: string,
  cliSessionId: string,
): Promise<CliSessionStatus | null> {
  const dir = await qoderSessionsDir(dataDirName, cwd);
  if (!dir) return null;
  const tail = await ipc
    .fsReadTail(`${dir}/${cliSessionId}.jsonl`, QODER_STATUS_TAIL_BYTES)
    .catch(() => "");
  if (!tail) return null;
  return extractQoderSessionStatus(tail);
}
/** 锚点栏数据源:文件名即会话 id,免扫目录直拼路径。 */
export async function readQoderUserMessages(
  dataDirName: string,
  cwd: string,
  cliSessionId: string,
  full: boolean,
) {
  const dir = await qoderSessionsDir(dataDirName, cwd);
  if (!dir) return null;
  return readUserMessagesFromFile(
    `${dir}/${cliSessionId}.jsonl`,
    full,
    qoderUserMessageLine,
  );
}

/**
 * settings.json → 默认模型/思考强度(纯函数,可测)。实证行型:
 * {"model":{"name":"qmodel_38max","preferences":{"minimax/minimax-m3-cp":
 *   {"reasoning":{"enabled":true,"effort":"max"}}}}}
 * effort 只认当前模型同名偏好键;两键全缺 = null(不猜)。
 */
export function parseQoderSettingsStatus(
  settingsJson: string,
): CliSessionStatus | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(settingsJson);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const modelBlock = (parsed as Record<string, unknown>).model;
  if (!modelBlock || typeof modelBlock !== "object") return null;
  const model = modelBlock as Record<string, unknown>;

  let name: string | undefined;
  if (typeof model.name === "string" && model.name) name = model.name;

  let effort: string | undefined;
  const preferences = model.preferences;
  if (name && preferences && typeof preferences === "object") {
    const pref = (preferences as Record<string, unknown>)[name];
    if (pref && typeof pref === "object") {
      const reasoning = (pref as Record<string, unknown>).reasoning;
      if (reasoning && typeof reasoning === "object") {
        const value = (reasoning as Record<string, unknown>).effort;
        if (typeof value === "string" && value) effort = value;
      }
    }
  }
  if (!name && !effort) return null;
  return { model: name, thinkingLevel: effort };
}

/** 默认态 IO 薄壳:读 <dataDir>/settings.json;读不到/异型 = null(不猜)。settings 是 KB 级小文件,fs_read_file 无压力。 */
export async function readQoderDefaultStatus(
  dataDirName: string,
): Promise<CliSessionStatus | null> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return null;
  const text = await ipc.fsReadFile(`${home}/${dataDirName}/settings.json`).catch(() => null);
  return text ? parseQoderSettingsStatus(text) : null;
}

/**
 * Qoder 品牌 glyph:几何 Q 字环 + 右下尾笔(stroke 环避开发填规则坑),
 * currentColor 随主题 —— 与 codex/kimi 同款的品牌中性处理,不硬编码官方色值。
 */
export function QoderGlyph({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      style={{ width: size, height: size, flexShrink: 0 }}
      aria-hidden
    >
      <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="2.6" />
      <path fill="currentColor" d="M17.9 16.9 21.8 20.8 20.9 21.7 17 17.8Z" />
    </svg>
  );
}
