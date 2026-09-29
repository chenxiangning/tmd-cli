/**
 * mcp-hub 状态层 —— 引擎解析 + 读写编排(管理面唯一数据源)。
 *
 * 引擎来自 CliProfile.mcpGlobalConfig 声明(候选路径相对 home;首个存在者 =
 * 读写目标,全缺 = 首个候选:JSON 家首存即建,TOML 家引擎隐藏不代造 config)。
 * 读 = tri-state(ok / missing / error,区分「不存在」与「不可读」防误覆写);
 * 写 = cli-shared/mcpWrite 纯函数变换 → backupOnce(.bak-tmd,cli-config/io.ts
 * 同纪律)→ fsWriteFile → 全量刷新。解析失败拒写,原文快照永不落盘破坏。
 */

import { ipc } from "@kernel/ipc";
import { host } from "@kernel/host";
import { createSubscribable } from "@kernel/subscribable";
import {
  parseJsonMcpServers,
  parseTomlMcpServers,
  removeJsonMcpServer,
  removeTomlMcpServer,
  upsertTomlMcpServer,
  writeJsonMcpServers,
  type McpServerEntry,
} from "@plugins/cli-shared/mcpWrite";
import { backupOnce } from "@plugins/cli-shared/providerChannels/backup";

/** 一台引擎的管理面快照。 */
export interface McpEngineState {
  profileId: string;
  name: string;
  format: "json" | "toml";
  /** 读写目标绝对路径(首个存在候选;全缺 = 首个候选)。 */
  path: string;
  /** 任一候选存在(JSON 家 false = 「尚未创建,首存即建」)。 */
  exists: boolean;
  /** 名 → 原生形状条目;null = 读取/解析失败(error 带文案)。 */
  entries: Record<string, McpServerEntry> | null;
  error?: string;
  /** 展示用路径(home 前缀缩为 ~;与 path 分离,IO 仍用绝对路径)。 */
  displayPath: string;
}

interface HubState {
  engines: McpEngineState[];
  loading: boolean;
  /** 右栏/中央共享的选中引擎(null = 缺省取首台)。 */
  selectedProfileId: string | null;
}

const store = createSubscribable<HubState>({ engines: [], loading: false, selectedProfileId: null });

/** 右栏点引擎 = 选中并打开管理 tab;中央 tab 读同一选中态(跨组件记忆)。 */
export function selectEngine(profileId: string): void {
  store.commit({ ...store.snapshot, selectedProfileId: profileId });
}

export function useHubState(): HubState {
  return store.useStore();
}

export function getHubEngines(): readonly McpEngineState[] {
  return store.snapshot.engines;
}

/** 读分三态:ok / missing(可首建)/ error(存在但不可读,阻断写防覆写)。 */
type TriRead = { kind: "ok"; text: string } | { kind: "missing" } | { kind: "error"; message: string };

/** 读失败用父目录清单区分「不存在」与「存在但不可读」(cli-config/io.ts 同法)。 */
async function readTriState(path: string): Promise<TriRead> {
  try {
    return { kind: "ok", text: await ipc.fsReadFile(path) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const cut = path.lastIndexOf("/");
    try {
      const entries = await ipc.fsCollectFiles(path.slice(0, cut), "");
      return entries.some((f) => f.name === path.slice(cut + 1))
        ? { kind: "error", message }
        : { kind: "missing" };
    } catch {
      return { kind: "error", message };
    }
  }
}

/** 全量刷新:重解析全部已声明引擎(TOML 家 config 缺失 = 不列)。 */
export async function refreshHub(): Promise<void> {
  store.commit({ ...store.snapshot, engines: [], loading: true });
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) {
    store.commit({ ...store.snapshot, engines: [], loading: false });
    return;
  }
  const shortHome = home.endsWith("/") ? home.slice(0, -1) : home;
  const displayPath = (target: string) =>
    target.startsWith(shortHome) ? `~${target.slice(shortHome.length)}` : target;
  const engines: McpEngineState[] = [];
  for (const profile of host.getCliProfiles()) {
    const cfg = profile.mcpGlobalConfig;
    if (!cfg) continue;
    let target = home + cfg.candidates[0];
    let read: TriRead = { kind: "missing" };
    for (const candidate of cfg.candidates) {
      read = await readTriState(home + candidate);
      if (read.kind !== "missing") {
        target = home + candidate;
        break;
      }
    }
    if (cfg.format === "toml" && read.kind === "missing") continue; // 不替用户造 config
    if (read.kind === "missing") {
      engines.push({
        profileId: profile.id, name: profile.name, format: cfg.format,
        path: target, displayPath: displayPath(target), exists: false, entries: {},
      });
      continue;
    }
    if (read.kind === "error") {
      engines.push({
        profileId: profile.id, name: profile.name, format: cfg.format,
        path: target, displayPath: displayPath(target), exists: true, entries: null, error: read.message,
      });
      continue;
    }
    try {
      const entries = cfg.format === "json" ? parseJsonMcpServers(read.text) : parseTomlMcpServers(read.text);
      engines.push({
        profileId: profile.id, name: profile.name, format: cfg.format,
        path: target, displayPath: displayPath(target), exists: true, entries,
      });
    } catch (e) {
      engines.push({
        profileId: profile.id, name: profile.name, format: cfg.format,
        path: target, displayPath: displayPath(target), exists: true, entries: null,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  store.commit({ ...store.snapshot, engines, loading: false });
}

/** 应用一次文本变换并写回(备份 → 变换 → 落盘 → 刷新)。 */
async function applyAndWrite(engine: McpEngineState, transform: (raw: string) => string): Promise<void> {
  const read = await readTriState(engine.path);
  if (read.kind === "error") throw new Error(read.message);
  if (engine.format === "toml" && read.kind === "missing") {
    throw new Error("config.toml 不存在;已拒写");
  }
  const raw = read.kind === "ok" ? read.text : "";
  const next = transform(raw); // 解析/序列化失败在此抛错,未触写盘
  if (read.kind === "ok") await backupOnce(engine.path); // 无原文件 = 无可备份
  else {
    /* JSON 家首存即建:CLI 装过没跑过时父目录也缺,幂等先建(marks/store 同款) */
    await ipc.fsCreateDir(engine.path.slice(0, engine.path.lastIndexOf("/"))).catch(() => undefined);
  }
  await ipc.fsWriteFile(engine.path, next);
  await refreshHub();
}

/** upsert 一台 server(同名整条替换;JSON 家目标文件缺失 = 首存即建)。 */
export async function upsertServer(engine: McpEngineState, name: string, entry: McpServerEntry): Promise<void> {
  await applyAndWrite(engine, (raw) =>
    engine.format === "json" ? writeJsonMcpServers(raw, { [name]: entry }) : upsertTomlMcpServer(raw, name, entry),
  );
}

/** 删除一台 server(名不存在 = 幂等同原文写回)。 */
export async function removeServer(engine: McpEngineState, name: string): Promise<void> {
  await applyAndWrite(engine, (raw) =>
    engine.format === "json" ? removeJsonMcpServer(raw, name) : removeTomlMcpServer(raw, name),
  );
}

/** 改名 = 删旧 + 增新(单次变换单次写盘,不留中间态)。 */
export async function renameServer(
  engine: McpEngineState,
  oldName: string,
  newName: string,
  entry: McpServerEntry,
): Promise<void> {
  await applyAndWrite(engine, (raw) => {
    if (engine.format === "json") {
      return writeJsonMcpServers(removeJsonMcpServer(raw, oldName), { [newName]: entry });
    }
    return upsertTomlMcpServer(removeTomlMcpServer(raw, oldName), newName, entry);
  });
}

/** 读引擎目标文件原文(原始预览用;缺失 = null)。 */
export async function readEngineRaw(engine: McpEngineState): Promise<string | null> {
  const read = await readTriState(engine.path);
  return read.kind === "ok" ? read.text : null;
}
