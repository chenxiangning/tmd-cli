/**
 * 移动壳凭证存取 —— 钥匙串优先(原生壳),localStorage 为浏览器态与一次性迁移旧值。
 * (300 行铁则拆分 + 迁移矩阵可独立单测。)
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
  /** 自建 https 中继证书钉住:证书 DER 的 SHA-256 base64(配对 offer 携带,原生壳 PinnedTLS 消费)。 */
  pin?: string;
  /** pin 对应的中继主机(relay URL 的 host,去端口);壳比对 TLS challenge 主机一致才启用。 */
  pinHost?: string;
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

/* 壳应答看门狗:壳二进制与前端契约漂移时(老壳不认识新方法,postMessage 无应答方),
 * 凭证链路若永挂,gate 停在 undefined → 整树白屏(2026-09-23 真机白屏根因)。
 * 所有壳往返一律限时;超时/异常同态处理,回落 localStorage,绝不丢已存凭证。 */
const SHELL_REPLY_TIMEOUT_MS = 3500;

type Timed<T> = { kind: "ok"; value: T } | { kind: "timeout" };

function withTimeout<T>(p: Promise<T>): Promise<Timed<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.then(
      (value): Timed<T> => ({ kind: "ok", value }),
      (): Timed<T> => ({ kind: "timeout" }),
    ),
    new Promise<Timed<T>>((resolve) => {
      timer = setTimeout(() => resolve({ kind: "timeout" }), SHELL_REPLY_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

/* 壳态钥匙串异步解析后 localStorage 被清(迁移语义),同步消费方需要内存缓存;
 * resolveCreds/persistCreds 是唯一写口,loadCreds 缓存优先。 */
let cached: MobileCreds | null | undefined;

/** 同步读(展示用):缓存优先,回落 localStorage(浏览器态/首帧前)。 */
export function loadCreds(): MobileCreds | null {
  return cached !== undefined ? cached : lsRead();
}

/** 启动凭证解析(含旧值迁移);非壳态 = localStorage。结果入缓存供同步消费方。 */
export async function resolveCreds(): Promise<MobileCreds | null> {
  if (!hasShellBridge()) {
    cached = lsRead();
    return cached;
  }
  const got = await withTimeout(shellCreds.get());
  if (got.kind === "ok" && got.value) {
    try {
      cached = JSON.parse(got.value) as MobileCreds;
      return cached;
    } catch {
      /* 凭证损坏 → 走旧值重迁 */
    }
  }
  const legacy = lsRead();
  cached = legacy;
  /* 超时(壳不应答)不做迁移写:写了也没人确认,保留 localStorage 待壳恢复后再迁。 */
  if (legacy && got.kind === "ok") {
    await persistCreds(legacy); // 尽力迁移;失败不阻塞本次会话
  }
  return legacy;
}

/** 凭证写入(配对成功/撤销清空);同步更新缓存。 */
export async function persistCreds(c: MobileCreds | null): Promise<void> {
  cached = c;
  if (!hasShellBridge()) {
    lsWrite(c);
    return;
  }
  const done = c
    ? await withTimeout(shellCreds.set(JSON.stringify(c)))
    : await withTimeout(shellCreds.delete());
  if (done.kind !== "ok") {
    lsWrite(c); // 钥匙串失败/壳不应答 → localStorage 兜底,下次启动再迁
    return;
  }
  lsWrite(null); // 钥匙串确认成功 → 清 localStorage(含迁移旧值)
}
