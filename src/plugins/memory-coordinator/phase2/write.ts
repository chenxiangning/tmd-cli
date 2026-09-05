/**
 * Phase 2 写入 —— d 路:借道 omp 会话代写(官方管线全保)。
 *
 * 机制(PoC-2 实证):omp 会话内 ctx_memory 工具是唯一权威写入口
 * (epoch 缓存协议 + authority 门控),tmd-cli 不直写 SQL;经
 * proc_communicate 跑 `omp -p` 非交互会话,由 omp 模型自己调用
 * ctx_memory 完成写入/归档 —— cwd 决定项目身份,必须与读取侧一致。
 *
 * 沉淀可配(settings,对齐上游推荐面):
 * - memoryDistillModel:提炼用模型(omp --model 覆盖;空 = 跟随 omp 默认);
 * - memoryDistillRules:补充规则(追加到提炼指令,优先遵循)。
 */

import { ipc } from "@kernel/ipc";

export interface WriteOutcome {
  ok: boolean;
  /** omp 模型的确认文本(截断),失败时为错误摘要。 */
  detail: string;
}

export interface DistillOptions {
  /** 提炼用模型(引擎 selector;空 = 跟随该引擎默认)。 */
  model?: string;
  /** 用户自定义补充规则(追加到指令,如「特别记住数据库决定;忽略测试细节」)。 */
  extraRules?: string;
  /** 代写引擎(omp/pi/opencode;默认 omp)。 */
  engine?: "omp" | "pi" | "opencode";
}

const OMP_TIMEOUT_MS = 120_000;

/**
 * 代写执行:omp/pi 走 `<engine> -p [--model m] <指令>`;opencode 走 `opencode run`
 * (其 run 子命令即非交互执行)。三家 Magic Context 插件均注册 ctx_memory,
 * cwd 决定项目身份,写入同一条官方管线。
 */
async function viaOmp(instruction: string, cwd: string, opts?: DistillOptions): Promise<WriteOutcome> {
  const engine = opts?.engine ?? "omp";
  const result =
    engine === "opencode"
      ? await ipc.procCommunicate({
          command: "opencode",
          args: opts?.model ? ["run", "-m", opts.model, instruction] : ["run", instruction],
          cwd,
          timeoutMs: OMP_TIMEOUT_MS,
        })
      : await ipc.procCommunicate({
          command: engine,
          args: opts?.model ? ["--model", opts.model, "-p", instruction] : ["-p", instruction],
          cwd,
          timeoutMs: OMP_TIMEOUT_MS,
        });
  const detail = (result.stdout || result.stderr).trim().slice(0, 300);
  if (result.code !== 0) {
    return { ok: false, detail: detail || `exit ${result.code ?? "?"}` };
  }
  return { ok: true, detail };
}

/** 引号清洗:内容进入指令文本前去掉双引号,避免破坏指令引号结构。 */
function sanitize(text: string): string {
  return text.replaceAll('"', "'").replaceAll("`", "'");
}

/** 手动添加 / 批量写入:逐条 ctx_memory(write)。 */
export async function rememberFacts(
  facts: { category: string; content: string }[],
  cwd: string,
  opts?: DistillOptions,
): Promise<WriteOutcome> {
  if (facts.length === 0) return { ok: false, detail: "无内容" };
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
