/**
 * 意图画布 · 类名拼接(mossx lib/utils cn 的零依赖替身:条件真值 join)。
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
