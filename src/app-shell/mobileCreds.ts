/**
 * 移动壳凭证存取 —— 钥匙串优先(原生壳),localStorage 为浏览器态与一次性迁移旧值。
 * 自 mobilePairing 拆出(300 行铁则 + 迁移矩阵可独立单测)。
 * 启动序(resolveCreds):壳态读钥匙串 → 命中即返;未命中查 localStorage 旧值 →
 * 迁移写钥匙串 → 删 localStorage;浏览器态维持 localStorage 原语义。
 * 写(persistCreds):壳态钥匙串(失败回落 localStorage,下次启动再迁);浏览器态 localStorage。
 */
import { hasShellBridge, shellCreds } from "@kernel/shellBridge";

export const CREDS_KEY = "tmd.mobile.creds.v1";

export interface MobileCreds {
  wsUrl: string;
  deviceId: string;
  token: string;
  hostName: string;
  /** M2 双通道:配对时 offer 的全部端点(ws://…);旧凭证缺省 = [wsUrl]。 */
  urls?: string[];
}

/* 通道钉选(M2 手动切换):auto = 按 urls 序竞速;否则只用该端点。 */
const PIN_KEY = "tmd.mobile.channel.v1";
export function loadChannelPin(): string {
  return localStorage.getItem(PIN_KEY) ?? "auto";
}
export function saveChannelPin(v: string) {
  if (v === "auto") localStorage.removeItem(PIN_KEY);
  else localStorage.setItem(PIN_KEY, v);
}

function lsRead(): MobileCreds | null {
  try {
    const raw = localStorage.getItem(CREDS_KEY);
    return raw ? (JSON.parse(raw) as MobileCreds) : null;
  } catch {
    return null;
  }
}

function lsWrite(c: MobileCreds | null) {
  try {
    if (c) localStorage.setItem(CREDS_KEY, JSON.stringify(c));
    else localStorage.removeItem(CREDS_KEY);
  } catch {
    /* 无痕/配额:静默,壳态有钥匙串兜底 */
  }
}

/** 同步 localStorage 读(RemoteHostBar 展示 hostName 等轻量消费)。 */
export function loadCreds(): MobileCreds | null {
  return lsRead();
}

/** 启动凭证解析(含旧值迁移);非壳态 = localStorage。 */
export async function resolveCreds(): Promise<MobileCreds | null> {
  if (!hasShellBridge()) return lsRead();
  try {
    const raw = await shellCreds.get();
    if (raw) return JSON.parse(raw) as MobileCreds;
  } catch {
    /* 钥匙串异常 → 走旧值路径 */
  }
  const legacy = lsRead();
  if (legacy) {
    await persistCreds(legacy); // 尽力迁移;失败不阻塞本次会话
  }
  return legacy;
}

/** 凭证写入(配对成功/撤销清空)。 */
export async function persistCreds(c: MobileCreds | null): Promise<void> {
  if (!hasShellBridge()) {
    lsWrite(c);
    return;
  }
  try {
    if (c) await shellCreds.set(JSON.stringify(c));
    else await shellCreds.delete();
    lsWrite(null); // 钥匙串成功 → 清 localStorage(含迁移旧值)
  } catch {
    lsWrite(c); // 钥匙串失败 → localStorage 兜底,下次启动再迁
  }
}
