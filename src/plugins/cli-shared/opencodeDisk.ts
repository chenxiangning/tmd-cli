/**
 * opencode 磁盘布局与凭据格式 —— opencode CLI 私有路径/文件知识共享层。
 *
 * 消费者:cli-opencode(会话库/配置读取,import 处注释声明)+ welcome(引擎卡
 * 已登录供应商盘点)—— 1 个 cli-* 插件 + feature 插件联合消费,满足 cli-shared 准入先例。
 *
 * 布局实证(opencode 1.18.25,本机,2026-09-05):
 * - 数据目录:$XDG_DATA_HOME(缺省 ~/.local/share)/opencode;内含 opencode.db
 *   (单库多会话 SQLite,WAL)与 auth.json;
 * - 配置目录:$XDG_CONFIG_HOME(缺省 ~/.config)/opencode;内含 opencode.json。
 * - auth.json 顶层 `{供应商id: {type: "api"|"oauth", key?, access?, ...}}`;
 *   api 型 key 在 `key` 字段,oauth 型无 key(盘点按「已登录」展示,不猜接口)。
 */

import { ipc } from "@kernel/ipc";

/** 家目录(configHomeDir 底层即 dirs::home_dir,omp 同款用法)。 */
async function homeDir(): Promise<string | null> {
  const home = await ipc.configHomeDir().catch(() => null);
  return home ? home.replace(/\/$/, "") : null;
}

/* quotaEnvValue 是通用环境变量读取原语,此处复用解析 XDG 覆盖。 */
async function xdgBase(env: "XDG_DATA_HOME" | "XDG_CONFIG_HOME", fallback: string): Promise<string | null> {
  const home = await homeDir();
  if (!home) return null;
  const xdg = await ipc.quotaEnvValue(env).catch(() => null);
  return xdg && xdg.startsWith("/") ? xdg : `${home}/${fallback}`;
}

/** opencode 数据目录;Windows 同公式待实机校验(读不到只会话列表为空,不误伤)。 */
export async function opencodeDataDir(): Promise<string | null> {
  const base = await xdgBase("XDG_DATA_HOME", ".local/share");
  return base ? `${base}/opencode` : null;
}

/** opencode 全局配置目录(全局 opencode.json / commands/ 所在)。 */
export async function opencodeConfigDir(): Promise<string | null> {
  const base = await xdgBase("XDG_CONFIG_HOME", ".config");
  return base ? `${base}/opencode` : null;
}

/** 单个供应商的凭据子集(只暴露盘点所需字段,不透传 refresh 等敏感位)。 */
export interface OpencodeAuthEntry {
  providerId: string;
  /** api 型密钥;oauth 型缺省。 */
  key?: string;
}

/** auth.json 文本 → 供应商凭据列表(纯函数,可测);解析失败/空对象 = null。 */
export function parseOpencodeAuth(raw: string): OpencodeAuthEntry[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const out: OpencodeAuthEntry[] = [];
  for (const [providerId, entry] of Object.entries(parsed as Record<string, unknown>)) {
    const key =
      entry && typeof entry === "object" ? (entry as Record<string, unknown>).key : undefined;
    out.push({
      providerId,
      ...(typeof key === "string" && key ? { key } : {}),
    });
  }
  return out.length ? out : null;
}

/** 读全部供应商凭据;文件不存在/损坏 = 空表(不抛,盘点按未配置降级)。 */
export async function listOpencodeAuthEntries(): Promise<OpencodeAuthEntry[]> {
  const dir = await opencodeDataDir();
  if (!dir) return [];
  const raw = await ipc.fsReadFile(`${dir}/auth.json`).catch(() => null);
  return raw ? (parseOpencodeAuth(raw) ?? []) : [];
}
