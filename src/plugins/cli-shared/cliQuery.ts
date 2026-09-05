/**
 * CLI JSON 查询通道 ── omp/pi 的 RPC 副车一次性查询与 grok inspect 共用底座。
 *
 * 语义(2026-09-04 双家实测,见 spec D1):
 * - `omp --mode rpc` / `pi --mode rpc` 是 stdin/stdout JSONL 协议;stdin 立即
 *   EOF 会丢响应 → procCommunicate 写完请求后持开管道,由 exitOnStdout
 *   (响应里的唯一请求 id)提前收割,超时兜底强杀;
 * - 响应行混在扩展噪声事件(extension_ui_request 等)之间,按 id 精确认领;
 * - grok inspect --json 无请求阶段,整段 stdout 即 JSON,走 queryCliRawJson。
 *
 * TTL 缓存与在途去重:omp 的 get_available_commands / pi 的 get_commands 一次
 * 响应同时覆盖 command+skill 两个 kind,适配器缓存原响应、按 kind 切片,
 * 避免 drawer(命令+技能并行取)触发两次 spawn。
 */

import { ipc } from "@kernel/ipc";
import type { CliSuggestion, TriggerKind } from "@kernel/cli";

/** RPC 冷启动 = CLI 加载全部扩展(实测 5-6s);20s 是异常兜底。 */
const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * 发起一次 id 关联的 JSONL RPC 查询,返回 id 匹配且 type === "response" 的整行对象。
 * 进程失败/超时/无匹配响应 = null(调用方回退静态表)。
 */
export async function queryCliRpc(
  spec: Omit<Parameters<typeof ipc.procCommunicate>[0], "stdin" | "exitOnStdout" | "timeoutMs">,
  request: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Record<string, unknown> | null> {
  const marker = `tmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const result = await ipc
    .procCommunicate({
      ...spec,
      stdin: JSON.stringify({ ...request, id: marker }) + "\n",
      exitOnStdout: marker,
      timeoutMs,
    })
    .catch(() => null);
  if (!result || result.timedOut) return null;
  for (const line of result.stdout.split("\n")) {
    if (!line.includes(marker)) continue;
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (obj.id === marker && obj.type === "response") return obj;
    } catch {
      /* 噪声行,继续找 */
    }
  }
  return null;
}

/** 无请求阶段的 JSON 程序(grok inspect --json):整段 stdout 解析;失败 null。 */
export async function queryCliRawJson(
  spec: Omit<Parameters<typeof ipc.procCommunicate>[0], "stdin" | "exitOnStdout" | "timeoutMs">,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown | null> {
  const result = await ipc
    .procCommunicate({ ...spec, timeoutMs })
    .catch(() => null);
  if (!result || result.timedOut) return null;
  try {
    return JSON.parse(result.stdout) as unknown;
  } catch {
    return null;
  }
}

/**
 * 协议响应 TTL 缓存 + 在途去重(get_commands 型查询的通用包装)。
 * fetcher 失败(null)不缓存,下次调用重试;同一 key 并发调用共享一次 spawn。
 */
export class CachedCliQuery<T> {
  private readonly cache = new Map<string, { at: number; value: T }>();
  private readonly inflight = new Map<string, Promise<T>>();

  constructor(
    private readonly fetcher: (cwd: string) => Promise<T>,
    private readonly ttlMs: number,
  ) {}

  /** 取 cwd 对应的查询结果;缓存命中/失败回退值由调用方决定(这里原样透传)。 */
  get(cwd: string): Promise<T> {
    const hit = this.cache.get(cwd);
    if (hit && Date.now() - hit.at < this.ttlMs) return Promise.resolve(hit.value);
    const running = this.inflight.get(cwd);
    if (running) return running;
    const promise = this.fetcher(cwd).then((value) => {
      /* CLI 临时不可用(升级中/断电)不该固化失败:TTL 内不重试,过期自然重查 */
      if (value !== null) this.cache.set(cwd, { at: Date.now(), value });
      return value;
    });
    this.inflight.set(cwd, promise);
    return promise.finally(() => this.inflight.delete(cwd));
  }
}

/* ── get_commands 型建议源工厂(omp / pi 同构适配器上提)──────────────────
 * 两家的差异只有:副车命令行、RPC 方法名、单项映射(hint 拼接等);
 * `skill:` 前缀分流、TTL 缓存、kind 切片全部共享。 */

/** 技能名前缀:pi 族原生语法 /skill:<name>,composer 侧存裸名、发送时翻译。 */
const SKILL_PREFIX = "skill:";

export interface RpcSuggestionSource {
  /** listSuggestions 契约实现;副车不可达/超时 = null(回退静态表)。 */
  list(kind: "command" | "skill", cwd: string): Promise<CliSuggestion[] | null>;
  /** 测试 seam:绕过 TTL 缓存直测 fetch 映射与失败语义。 */
  fetchForTest(cwd: string): Promise<Map<TriggerKind, CliSuggestion[]> | null>;
}

/** 构造一个 get_commands 型建议源。mapCommand 收原始命令对象,返回
 *  { name(含 skill: 前缀时的原名), description };前缀剥壳与分桶由工厂做。 */
export function createRpcSuggestionSource(spec: {
  spawn: { command: string; args: readonly string[] };
  method: string;
  mapCommand: (cmd: Record<string, unknown>) => { name: string; description?: string };
  ttlMs?: number;
}): RpcSuggestionSource {
  async function fetchByKind(
    cwd: string,
  ): Promise<Map<TriggerKind, CliSuggestion[]> | null> {
    const response = await queryCliRpc(
      { command: spec.spawn.command, args: [...spec.spawn.args], cwd },
      { type: spec.method },
    );
    const data = response?.data as { commands?: unknown[] } | undefined;
    if (response?.success !== true || !Array.isArray(data?.commands)) return null;
    const byKind = new Map<TriggerKind, CliSuggestion[]>([
      ["command", []],
      ["skill", []],
    ]);
    for (const raw of data.commands) {
      if (typeof raw !== "object" || raw === null) continue;
      const mapped = spec.mapCommand(raw as Record<string, unknown>);
      if (typeof mapped?.name !== "string") continue;
      const skill = mapped.name.startsWith(SKILL_PREFIX);
      byKind.get(skill ? "skill" : "command")?.push({
        value: skill ? mapped.name.slice(SKILL_PREFIX.length) : mapped.name,
        description: mapped.description,
        action: "insert",
      });
    }
    return byKind;
  }

  const cached = new CachedCliQuery(fetchByKind, spec.ttlMs ?? 5 * 60_000);
  return {
    async list(kind, cwd) {
      const byKind = await cached.get(cwd);
      return byKind?.get(kind) ?? null;
    },
    fetchForTest: fetchByKind,
  };
}
