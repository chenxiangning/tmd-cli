/**
 * 本地插件装载件:shim 生成 / specifier 重写 / 清单与导出校验。
 * 纯函数为主;importBundle 是唯一副作用出口(blob URL + 动态 import)。
 * 设计契约见 docs/superpowers/specs/2026-09-10-local-plugins-design.md。
 */
import { PLUGIN_PERMISSIONS } from "./plugin";
import type { Plugin, PluginMeta } from "./plugin";

/** 裸 specifier 白名单:插件 bundle 唯一合法的外部 import 面。 */
const SHIM_SPECIFIERS = ["react", "react-dom", "react/jsx-runtime", "tmd-sdk"] as const;

/** 当前内核 API 纪元:注册面破坏性变更时 bump,旧插件装载即拒。
 *  v2(2026-09-10):manifest.permissions 生效,SDK 收窄为按授权装配 —— v1 插件一律重装。 */
const LOCAL_PLUGIN_API_VERSION = 2;


/** ESM 具名导出必须静态声明:按模块 key 动态拼 shim 文本;default 键走默认导出(非法标识符特例)。 */
export function buildShimText(keys: string[]): string {
  const named = keys.filter((k) => k !== "default" && /^[A-Za-z_$][\w$]*$/.test(k));
  const lines = named.map((k) => `export const ${k} = m[${JSON.stringify(k)}];`);
  if (keys.includes("default")) lines.push(`export default m["default"];`);
  return `${lines.join("\n")}\n`;
}

const shimUrlCache = new Map<string, string>();

/** shim 模块 → blob URL(按 specifier 缓存,一次 boot 只建一份)。 */
export function shimUrl(spec: string): string {
  const cached = shimUrlCache.get(spec);
  if (cached) return cached;
  const source = window.__TMD_SHIMS?.[spec];
  if (!source) throw new Error(`内核 shim 未就绪: ${spec}`);
  const text =
    `const m = window.__TMD_SHIMS[${JSON.stringify(spec)}];\n` +
    buildShimText(Object.keys(source));
  /* data URL 免 createObjectURL/revoke 配对:shim 文本仅白名单键声明,体量小。 */
  const url = `data:text/javascript;base64,${btoa(unescape(encodeURIComponent(text)))}`;
  shimUrlCache.set(spec, url);
  return url;
}

/** 把 bundle 文本里白名单裸 specifier 重写为 shim blob URL;白名单外的导入原样保留。 */
export function rewriteSpecifiers(
  source: string,
  shimUrlFor: (spec: string) => string,
): string {
  let out = source;
  for (const spec of SHIM_SPECIFIERS) {
    const esc = spec.replace(/[/.]/g, "\\$&");
    out = out
      .replace(new RegExp(`(from\\s*)["']${esc}["']`, "g"), `$1"${shimUrlFor(spec)}"`)
      .replace(new RegExp(`(import\\(\\s*)["']${esc}["']`, "g"), `$1"${shimUrlFor(spec)}"`);
  }
  return out;
}

/** tmd-sdk 的按插件寻址 shim key(权限实例逐插件装配;sdkKey 携带内容 hash 免模块缓存串味)。 */
export function sdkShimKey(id: string, contentHash: string): string {
  return `tmd-sdk:${id}:${contentHash}`;
}

/** manifest.permissions → 授权清单(未声明 = 纯 UI:空数组;非法形状已在 validateManifest 拒)。 */
export function manifestPermissions(manifest: Record<string, unknown>): string[] {
  const perms = manifest.permissions;
  if (!Array.isArray(perms)) return [];
  return perms.filter(
    (p): p is string => typeof p === "string" && (PLUGIN_PERMISSIONS as readonly string[]).includes(p),
  );
}

/** bundle 文本 → 模块命名空间。specifier 是运行时 blob URL,静态 import 不可能(spec 装载机制节)。
 *  sdkKey = 装载前 installPluginSdkShim 装配的 tmd-sdk 实例寻址(含内容 hash,热更即新实例)。 */
export async function importBundle(text: string, sdkKey: string): Promise<Record<string, unknown>> {
  const rewritten = rewriteSpecifiers(text, (spec) =>
    spec === "tmd-sdk" ? shimUrl(`tmd-sdk:${sdkKey}`) : shimUrl(spec),
  );
  const url = URL.createObjectURL(new Blob([rewritten], { type: "text/javascript" }));
  try {
    return (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
  } finally {
    URL.revokeObjectURL(url); // import 解析后模块已求值入缓存,URL 可回收
  }
}

/** 清单校验(前端侧三条;id 与目录名一致、16MB 上限由 Rust 扫描/读原语拦截)。 */
export function validateManifest(
  manifest: Record<string, unknown>,
  builtinIds: ReadonlySet<string>,
): string | null {
  const id = manifest.id;
  if (typeof id !== "string" || !id) return "manifest 缺少合法 id";
  if (builtinIds.has(id)) return `插件 id 与内置插件冲突: ${id}`;
  if (manifest.apiVersion !== LOCAL_PLUGIN_API_VERSION) {
    return `API 纪元不匹配: 插件 ${String(manifest.apiVersion)} / 客户端 ${LOCAL_PLUGIN_API_VERSION}`;
  }
  if (manifest.permissions !== undefined) {
    const perms = manifest.permissions;
    const bad =
      !Array.isArray(perms) ||
      perms.some((p) => !(PLUGIN_PERMISSIONS as readonly string[]).includes(p as string));
    if (bad) return `非法 permissions(须为 PLUGIN_PERMISSIONS 子集): ${JSON.stringify(perms)}`;
  }
  if (manifest.category === "core") return "本地插件不允许 core 分类(焊死层属内置)";
  const entry = manifest.entry;
  if (entry !== undefined && (typeof entry !== "string" || !/^[\w.-]+$/.test(entry))) {
    return `非法入口名: ${String(entry)}`;
  }
  return null;
}

/** 导出形状校验:默认导出(或具名 plugin)的 Plugin 对象,id 与 manifest 一致,activate 可调用。 */
export function validatePluginExport(mod: Record<string, unknown>, id: string): string | null {
  const raw = mod.default ?? mod.plugin;
  if (!raw || typeof raw !== "object") return "插件缺少默认导出(或具名 plugin)的 Plugin 对象";
  const p = raw as Partial<Plugin>;
  if (p.id !== id) return `导出 id(${String(p.id)})与 manifest(${id})不一致`;
  if (typeof p.activate !== "function") return "插件缺少 activate 方法";
  return null;
}

/** manifest → PluginMeta(icon 缺省走插排页 abbr 兜底,与内置插件同语义)。 */
export function synthesizeMeta(manifest: Record<string, unknown>): PluginMeta {
  const id = String(manifest.id ?? "");
  const s = (v: unknown, fb: string) => (typeof v === "string" && v ? v : fb);
  return {
    name: s(manifest.name, id),
    desc: s(manifest.desc, ""),
    abbr: s(manifest.abbr, id.slice(0, 2).toUpperCase()),
    category: manifest.category === "engine" ? "engine" : "feature",
    ...(typeof manifest.iconColor === "string" ? { iconColor: manifest.iconColor } : {}),
  };
}

