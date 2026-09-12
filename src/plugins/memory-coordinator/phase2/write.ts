/**
 * Phase 2 写入 —— d 路 v2:借道引擎子代理(magic-context 插件的 ctx_memory 工具)。
 *
 * 机制(PoC-7/8 实证,见 docs/research/magic-context-poc-report.md 与
 * docs/review/2026-09-06-d-path-flag-fix.md):magic-context 的 ctx_memory 工具只在
 * main agent 启动 subagent 时由 subagent-entry.js 注册,需 `--magic-context-dreamer-actions`
 * flag。`omp -p` / `pi -p` / `opencode run` 直跑不会触发该路径。本模块模拟 main agent 启动
 * subagent 的参数组合:
 *
 *   omp --extension <subagent-entry.js> \
 *        --magic-context-dreamer-actions \
 *        --tools ctx_memory \
 *        --no-session \
 *        [--model m] -p "<指令>"
 *
 * opencode:走 `opencode run`,前提是装了 `@cortexkit/opencode-magic-context` 插件;
 * 走前做目录存在性预检,缺失返 `missing-plugin`。
 *
 * `--no-session` 避免一次性 subprocess 落 omp 会话;`--tools ctx_memory` 收敛工具列表,
 * 避免主进程默认工具(read/write/bash/...)被带进 subprocess 引入治理面泄露。
 *
 * cwd 决定项目身份,必须与读取侧一致;失败 detail 由 UI 兜底。
 *
 * 沉淀可配(settings,对齐上游推荐面):
 * - memoryDistillModel:提炼用模型(omp --model 覆盖;空 = 跟随 omp 默认);
 * - memoryDistillRules:补充规则(追加到提炼指令,优先遵循)。
 */

import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import {
  isOpencodeMagicContextInstalled,
  resolveSubagentEntry,
} from "../paths";

interface WriteOutcome {
  ok: boolean;
  /** omp 模型的确认文本(截断),失败时为错误摘要。 */
  detail: string;
}

interface DistillOptions {
  /** 提炼用模型(引擎 selector;空 = 跟随该引擎默认)。 */
  model?: string;
  /** 用户自定义补充规则(追加到指令,如「特别记住数据库决定;忽略测试细节」)。 */
  extraRules?: string;
  /** 代写引擎(omp/pi/opencode;默认 omp)。 */
  engine?: "omp" | "pi" | "opencode";
}

const OMP_TIMEOUT_MS = 120_000;

/**
 * 拼出 omp/pi 子代理启动参数(模拟 main agent 启动 subagent 的形态)。
 * 导出供 write.test.ts 断言;viaOmp 内部不再内联拼装。
 */
export function buildSubagentArgs(opts: {
  model?: string;
  instruction: string;
  subagentEntry: string;
}): string[] {
  const args: string[] = [
    "--extension",
    opts.subagentEntry,
    "--magic-context-dreamer-actions",
    "--tools",
    "ctx_memory",
    "--no-session",
  ];
  if (opts.model) args.push("--model", opts.model);
  args.push("-p", opts.instruction);
  return args;
}

/**
 * 代写执行:omp/pi 走 subagent 形态(见文件头);opencode 走 `opencode run`(预检插件安装)。
 * 失败原因由 detail 携带:
 * - `missing-subagent-entry`:omp/pi 的 magic-context 未装或路径偏移
 * - `missing-plugin: opencode magic-context`:opencode 适配器未装
 */
async function viaOmp(instruction: string, cwd: string, opts?: DistillOptions): Promise<WriteOutcome> {
  const engine = opts?.engine ?? "omp";
  if (engine === "opencode") {
    if (!(await isOpencodeMagicContextInstalled())) {
      return {
        ok: false,
        detail: t(
          "missing-plugin: opencode magic-context 未安装,d 路过 opencode 需先安装 @cortexkit/opencode-magic-context",
        ),
      };
    }
    const result = await ipc.procCommunicate({
      command: "opencode",
      args: opts?.model ? ["run", "-m", opts.model, instruction] : ["run", instruction],
      cwd,
      closeStdin: true,
      timeoutMs: OMP_TIMEOUT_MS,
    });
    const detail = (result.stdout || result.stderr).trim().slice(0, 300);
    if (result.code !== 0) return { ok: false, detail: detail || `exit ${result.code ?? "?"}` };
    return { ok: true, detail };
  }
  const subagentEntry = await resolveSubagentEntry();
  if (!subagentEntry) {
    return {
      ok: false,
      detail: t("missing-subagent-entry: magic-context subagent-entry.js 未找到,d 路 v2 需此文件"),
    };
  }
  const result = await ipc.procCommunicate({
    command: engine,
    args: buildSubagentArgs({ model: opts?.model, instruction, subagentEntry }),
    cwd,
    closeStdin: true,
    timeoutMs: OMP_TIMEOUT_MS,
  });
  const detail = (result.stdout || result.stderr).trim().slice(0, 300);
  if (result.code !== 0) return { ok: false, detail: detail || `exit ${result.code ?? "?"}` };
  return { ok: true, detail };
}

/** 引号清洗:内容进入指令文本前去掉双引号,避免破坏指令引号结构。 */
function sanitize(text: string): string {
  return text.replaceAll('"', "'").replaceAll('`', "'");
}

/** 手动添加 / 批量写入:逐条 ctx_memory(write)。 */
export async function rememberFacts(
  facts: { category: string; content: string }[],
  cwd: string,
  opts?: DistillOptions,
): Promise<WriteOutcome> {
  if (facts.length === 0) return { ok: false, detail: t("无内容") };
  const list = facts.map((f, i) => `${i + 1}. category="${f.category}" content="${sanitize(f.content)}"`).join("\n");
  const instruction =
    `请调用 ctx_memory 工具,action=write,将以下 ${facts.length} 条记忆逐条写入 ` +
    `(不要改名其他记忆,写完只回复"已写入 ${facts.length} 条"):\n${list}`;
  return viaOmp(instruction, cwd, opts);
}

/** 面板「合并」:ctx_memory(action=merge)折叠重复记忆(≥2 条,content 为保留表述)。 */
export async function mergeMemories(
  ids: number[],
  content: string,
  cwd: string,
  opts?: DistillOptions,
): Promise<WriteOutcome> {
  const instruction =
    `执行记忆合并:立即调用 ctx_memory 工具,参数 action="merge", ids=[${ids.join(", ")}], content="${sanitize(content)}"(该 content 为合并后保留的表述)。` +
    `不要解释、不要反问,工具调用完成后只回复"已合并"。`;
  return viaOmp(instruction, cwd, opts);
}

/** 面板「移除」:ctx_memory(action=archive)退役指定记忆(上游可恢复语义)。 */
export async function archiveMemory(memoryId: number, cwd: string): Promise<WriteOutcome> {
  const instruction =
    `执行记忆归档:立即调用 ctx_memory 工具,参数 action="archive", ids=[${memoryId}], reason="用户在 tmd-cli 面板移除"。` +
    `不要解释、不要反问,工具调用完成后只回复"已归档"。`;
  return viaOmp(instruction, cwd);
}

/** 会话尾部提炼:把用户消息尾段交给 omp 模型,提炼值得长期记忆的事实并写入。 */
export async function distillSessionTail(
  sessionTail: string,
  cwd: string,
  opts?: DistillOptions,
): Promise<WriteOutcome> {
  const rules = opts?.extraRules?.trim() ? `\n补充规则(用户自定义,优先遵循):${opts.extraRules.trim()}` : "";
  const instruction =
    `以下是本项目最近一次 omp 会话的用户消息节选。请从中提炼值得长期记住的项目事实 ` +
    `(项目规则/架构/约束/配置值/命名/用户偏好等,忽略一次性请求与闲聊),` +
    `逐条调用 ctx_memory 工具(action=write)写入,写完只回复"提炼完成 N 条"。` +
    `若没有值得沉淀的内容,只回复"无可沉淀内容"。${rules}\n\n--- 会话节选 ---\n${sessionTail}`;
  return viaOmp(instruction, cwd, opts);
}