/**
 * DSH host-RPC 浏览器侧客户端(域逻辑,无 UI)—— 0.1.2 typert gateway 线格式:
 * POST {origin}/api/<namespace>/<method> {type:"client-request",rpcId,method,
 * payload:{args}} → {type:"server-response",rpcId,result:{ok,value}|{ok:false,error}}。
 * HTTP 走通用 quota_fetch 通道(R3:插件不 import @tauri-apps/*);全部请求
 * 需 BrowserAuth cookie(authHeaders 注入,0.1.2 新增门禁)。
 * 用途:listSessions/resumeArgs/readSessionStatus 等 CliProfile 钩子的数据源。
 */
import { ipc } from "@kernel/ipc";
import { pathsEqual } from "@kernel/pathUtils";
import type { CliDiskSession, CliSessionStatus } from "@kernel/cli";
import type { DshConnection } from "./dshConnection";
import { authHeaders, originOf } from "./dshConnection";
import { hostStartInFlight, waitForHostReady } from "./dshHost";
import { findDshSessionDir, zstdVersionOf } from "./dshSessionStore";

/** 单次 RPC;失败一律 null(调用方按缺省处理,不猜)。 */
async function rpc<T>(conn: DshConnection, method: string, args: object): Promise<T | null> {
  try {
    const res = await ipc.quotaFetch({
      url: `${originOf(conn)}/api/${method}`,
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders(conn) },
      body: JSON.stringify({
        type: "client-request", rpcId: `tmd-${Date.now()}`, method, payload: { args: args || {} },
      }),
    });
    const env = res.body as {
      type?: string;
      result?: { ok?: boolean; value?: T };
    } | null;
    if (res.status !== 200 || env?.type !== "server-response" || !env.result?.ok) return null;
    return env.result.value ?? null;
  } catch {
    return null;
  }
}

interface DshSessionListItem {
  sessionId?: string;
  cwd?: string;
  updatedAt?: number;
  /* 会话身份判据(session/list 的 listFields 直出):子代理子会话 origin=
     "subagent" 且带 parentSessionId,可 attach 性见 isAdoptableDshSession。 */
  origin?: string;
  parentSessionId?: string;
  /* 活会话标志(summaryFor 直出):attached/running 的会话被删盘 = DSH 侧下次
     append ENOENT、历史不可恢复,删除闸靠这两个字段。 */
  running?: boolean;
  agentAvailable?: boolean;
  projections?: {
    values?: {
      title?: string;
      contextPressure?: DshContextPressure;
      contextBreakdown?: DshContextBreakdown;
      modelSelection?: { next?: { provider?: string; model?: string }; lastUsed?: { provider?: string; model?: string } };
    };
  };
  blank?: boolean;
}

interface DshContextPressure {
  pressureTokens?: number;
  projectedTokens?: number;
  contextWindow?: number;
}
interface DshContextBreakdown {
  systemTokens?: number;
  toolsTokens?: number;
  messageTokens?: number;
}

/**
 * 会话是否可被 tmd-cli 接管(session/create 显式 id 采用)。
 * 子代理子会话的会话生命周期归 subagent routing:拿它的 id 去 session/create
 * 必被 host 拒绝(`session/agent-busy`: "session ... is owned by subagent
 * routing"),适配器只能报「会话创建失败」然后退出 —— 侧栏列出多少条,用户就
 * 有多少条点开即崩的死行(2026-10-02 实测本机 tmd-cli 工作区 90 条里 75 条是
 * 客户端子代理扇出的子会话)。DSH 自己的 Web UI 工作区会话列表同样过滤
 * 它们(dsh-client-ui-workspace: `if (session.origin === "subagent") return
 * false`),这里按同一判据对齐,不猜、不兜底。
 */
export function isAdoptableDshSession(item: { origin?: string; parentSessionId?: string }): boolean {
  return item.origin !== "subagent" && item.parentSessionId === undefined;
}

/** session.list → 该 cwd 的磁盘历史会话(host 全量返回,按 cwd 与可接管性过滤)。
 *  blank(被 host 预创建、从未发过消息的空壳)不过滤 —— dsh Web UI 计数含空壳,
 *  tmd-cli 隐藏会造成两边数量对不上,且空壳垃圾(每次适配器拉起遗留一个)必须
 *  可见才可清(2026-09-07 实测:springboot-demo 41 = 31 非空 + 10 空壳)。
 *  启动竞态补扫:侧栏扫描常早于面板自动拉起的 host 就绪(无「host 就绪」重扫信号),
 *  有在途启动(hostStartInFlight)→ 等就绪后补试一次;无 → 维持快速空。
 *  判据只认「真有人在拉起」:早前版本按 conn.autoStart 判,host 被用户停掉后
 *  每次扫盘都白等一轮 24s 轮询(没人在启动,等不到任何结果)。 */
export async function listHostSessions(
  conn: DshConnection, cwd: string,
): Promise<CliDiskSession[]> {
  let value = await rpc<{ items?: DshSessionListItem[] }>(conn, "session/list", { _request: {} });
  if (!value && hostStartInFlight() && await waitForHostReady(conn)) {
    value = await rpc<{ items?: DshSessionListItem[] }>(conn, "session/list", { _request: {} });
  }
  const items = Array.isArray(value?.items) ? value.items : [];
  const named = items.filter(
    (it): it is DshSessionListItem & { sessionId: string } => typeof it.sessionId === "string",
  );
  /* 先按原串比(分隔符/尾斜杠归一);一条都不中才问 host 要 canon 键 ——
     工作区 root 是符号链接时 DSH 存的 cwd 是 realpath,直比会整片历史凭空消失。 */
  let mine = named.filter((it) => pathsEqualCwd(it.cwd, cwd));
  if (mine.length === 0 && named.length > 0) {
    const canon = await canonWorkspacePath(conn, cwd);
    if (canon !== null) mine = named.filter((it) => pathsEqualCwd(it.cwd, canon));
  }
  return mine.flatMap((it) =>
    isAdoptableDshSession(it)
      ? [
          {
            id: it.sessionId,
            title: it.projections?.values?.title || (it.blank ? "空会话" : undefined),
            modifiedAt: typeof it.updatedAt === "number" ? it.updatedAt : 0,
            /* DSH 会话无单文件路径(zstd 流在 host 侧,删除走目录扫描)。旧实现这里
               塞了 `${origin}/${id}` 的伪 URL,消费方(SessionSpeedPill)按磁盘路径
               喂 fsReadTailChanged → 每 2s 一次必然失败的 IO。空串 = 无本地路径,
               消费方按缺失跳过(与全族「缺失显示 —」同口径)。 */
            path: "",
          },
        ]
      : [],
  );
}

/** cwd 等值:分隔符与尾斜杠归一(realpath 交给 host 的 canon 键,内核不做 realpath)。 */
function pathsEqualCwd(itemCwd: string | undefined, cwd: string): boolean {
  return typeof itemCwd === "string" && pathsEqual(itemCwd, cwd, false);
}

/**
 * 工作区 canon 键:host 的 workspace/create 返回它规范化后的 path(realpath +
 * 去尾斜杠 + 解 `..`),session.list 的 cwd 就是同一基准。工作区 root 是符号链接
 * 时(含 macOS `/tmp` → `/private/tmp`)直比字符串会把整片历史静默判成「不属于
 * 本工作区」(侧栏历史凭空消失)。取不到 canon 就退回原串直比,不猜。
 */
async function canonWorkspacePath(conn: DshConnection, cwd: string): Promise<string | null> {
  const v = await rpc<{ workspace?: { path?: string } }>(conn, "workspace/create", {
    request: { path: cwd },
  });
  const p = v?.workspace?.path;
  return typeof p === "string" && p ? p : null;
}

/**
 * 删除一个 DSH 会话(deleteSession 钩子)。host 0.1.2-rc.1 仍无删除 RPC(0.1.2
 * typert 清单无 session/delete;0.1.1 实测 session.delete 404),唯一通路 =
 * 会话盘 `~/.dsh/sessions/<slug>/<dir>/`;host 对 session.list 活扫描磁盘,
 * 目录移除后列表立即同步,Web UI 同源跟随(实测运行中移走目录,session.list
 * 当次即少一条)。目录名两代形制(裸 uuid / session-<uuid>)判据收在
 * dshSessionStore,与转录定位共用;找不到 = 已删除,幂等成功。
 */
export async function deleteHostSession(conn: DshConnection, cliSessionId: string): Promise<void> {
  /* 活会话拒绝删盘:DSH 每次 durable append 都按路径 open("a"),目录被整树删掉
     后下一次写直接 ENOENT,历史不可恢复(DSH lease 文档:harness 从不移除活会话
     的锁文件)。调用方 removeDiskSessionBestEffort 的设计就是「钩子失败 → 只在
     tmd-cli 侧隐藏,tombstone 照样生效,磁盘数据保留」,所以这里抛错是安全收口。 */
  const state = await rpc<{ items?: DshSessionListItem[] }>(conn, "session/list", { _request: {} });
  const live = (state?.items || []).find((s) => s.sessionId === cliSessionId);
  if (live && (live.running === true || live.agentAvailable === true)) {
    throw new Error(`DSH host 正持有该会话(attached/running),拒绝删盘: ${cliSessionId}`);
  }
  const dir = await findDshSessionDir(cliSessionId);
  if (!dir) return;
  /* 目录里必须真有会话盘文件:防扫到同名非会话目录误删。 */
  const hasSessionFile = (await ipc.fsListDir(dir).catch(() => []))
    .some((e) => zstdVersionOf(e.name) >= 0);
  if (!hasSessionFile) return;
  await ipc.fsRemovePath(dir).catch(() => undefined);
}

/** session/list 自项 modelSelection → 当前模型与思考强度。 */
export async function readHostSessionStatus(
  conn: DshConnection, cliSessionId: string,
): Promise<CliSessionStatus | null> {
  const value = await rpc<{ items?: DshSessionListItem[] }>(conn, "session/list", { _request: {} });
  const it = (value?.items || []).find((s) => s.sessionId === cliSessionId);
  const ms = it?.projections?.values?.modelSelection;
  const cur = ms?.next ?? ms?.lastUsed;
  if (!cur?.model) return null;
  return { model: cur.provider ? `${cur.provider}/${cur.model}` : cur.model };
}

/** session/modelCatalog 默认路由 → 状态种子(0.1.2 起 host.describe 删除)。 */
export async function readHostDefaultStatus(conn: DshConnection): Promise<CliSessionStatus | null> {
  const value = await rpc<{ default?: { provider?: string; model?: string } }>(conn, "session/modelCatalog", {});
  const def = value?.default;
  if (!def?.model) return null;
  return { model: def.provider ? `${def.provider}/${def.model}` : def.model };
}

/** session.list 定位单会话的上下文投影(pressure + 分解,额度弹窗消费)。 */
export async function readHostContextPressure(
  conn: DshConnection, cliSessionId: string,
): Promise<{ used: number; window: number; breakdown?: DshContextBreakdown } | null> {
  const value = await rpc<{ items?: DshSessionListItem[] }>(conn, "session/list", { _request: {} });
  const it = (value?.items || []).find((s) => s.sessionId === cliSessionId);
  const cp = it?.projections?.values?.contextPressure;
  if (!cp || typeof cp.projectedTokens !== "number" || typeof cp.contextWindow !== "number" || cp.contextWindow <= 0) return null;
  return {
    /* 取值序对齐官方 contextOccupancy(dsh-client-ui-conversation:
       `projectedTokens ?? pressureTokens`):pressureTokens 只是最近一次 provider
       上报的 prompt 大小,压缩/替换后看不见 surface 变化,会停在旧的偏大值。 */
    used: cp.projectedTokens ?? cp.pressureTokens,
    window: cp.contextWindow,
    breakdown: it?.projections?.values?.contextBreakdown,
  };
}

/** 会话卫生判空:session.list 自项 blank 标志(host 预创建、从未发过消息的空壳,
 *  即 listHostSessions 显示「空会话」的同源判定)。list 失败/会话不在册 = false
 *  (判不了不删,与其他引擎钩子同一保守口径)。 */
export async function isHostSessionEmpty(
  conn: DshConnection, cliSessionId: string,
): Promise<boolean> {
  const value = await rpc<{ items?: DshSessionListItem[] }>(conn, "session/list", { _request: {} });
  if (!value) return false;
  const it = (value.items || []).find((s) => s.sessionId === cliSessionId);
  return it !== undefined && it.blank === true;
}
