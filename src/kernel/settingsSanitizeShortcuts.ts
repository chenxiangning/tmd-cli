/**
 * 快捷键改写覆盖层清洗 —— settings.shortcutOverrides 的 sanitize(自 settingsSanitizeSessions
 * 域文件先例)。承担:外部 JSON → 合法 Record<commandId, keybinding|""> 的全部清洗逻辑;
 * 非法 key/value 丢弃,超容量按 key 序截断,value 规范化(修饰键按 Cmd→Shift→Alt 顺序拼接,
 * 大小写统一)。装配仍在 settingsSanitize.ts 的 sanitize()。
 *
 * 录制期消费:在 ShortcutTab UI 录制流程里只调 `validateOverride`(在 shortcutOverrides.ts),
 * 校验通过后整张表落 settings;此处只对磁盘加载的 JSON 做防线式清洗,写路径不走这里
 * (走 `updateSettings` 内 sanitize 全套)。
 */


/** 改写层容量上限:200 条(覆盖场景 = 100+ 已知命令的有限子集,余量充裕);key 1–100 字符。 */
const SHORTCUT_OVERRIDES_MAX_ENTRIES = 200;
const SHORTCUT_OVERRIDE_KEY_MAX = 100;
const SHORTCUT_OVERRIDE_VALUE_MAX = 60;

/** 规范化键位串:大小写统一(主键小写,修饰键统一为 Cmd/Shift/Alt)+ 顺序统一为 Cmd→Shift→Alt;无法解析返回 null。 */
export function normalizeKeybinding(kb: string): string | null {
  if (kb === "") return "";
  const parts = kb.split("+").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null; // 裸键不做全局拦截(与 registerCommand 同款)
  const cap = (s: string): string =>
    s.toLowerCase() === "cmd" ? "Cmd" :
    s.toLowerCase() === "shift" ? "Shift" :
    s.toLowerCase() === "alt" ? "Alt" : "";
  let meta = false;
  let shift = false;
  let alt = false;
  for (const p of parts.slice(0, -1)) {
    const c = cap(p);
    if (c === "") return null;
    if (c === "Cmd") meta = true;
    else if (c === "Shift") shift = true;
    else if (c === "Alt") alt = true;
  }
  const key = parts[parts.length - 1].toLowerCase();
  if (!key) return null;
  const out: string[] = [];
  if (meta) out.push("Cmd");
  if (shift) out.push("Shift");
  if (alt) out.push("Alt");
  out.push(key);
  return out.join("+");
}

/** 清洗入口:仅录入合法键位串或 `""`(显式解绑);按 key 升序限量。 */
export function sanitizeShortcutOverrides(
  raw: unknown,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  const entries = raw as Record<string, unknown>;
  for (const key of Object.keys(entries).sort()) {
    if (Object.keys(out).length >= SHORTCUT_OVERRIDES_MAX_ENTRIES) break;
    if (!key || typeof key !== "string") continue;
    if (key.length > SHORTCUT_OVERRIDE_KEY_MAX) continue;
    const value = entries[key];
    if (typeof value !== "string") continue;
    const normalized = normalizeKeybinding(value.slice(0, SHORTCUT_OVERRIDE_VALUE_MAX));
    if (normalized === null) continue;
    out[key] = normalized;
  }
  return out;
}


