/**
 * 草稿 → 协议文本 → 写入 PTY 的翻译管线。
 *
 * 约定:
 * - trigger 触发后保留触发符 + 后面的 token,profile.translate(token) 把它转成对应 CLI 的语法
 * - 例如 omp 的 $触发: 文本里出现 "<think>" → translate → "/skill:think"
 *
 * Step 3 只做组装,不接 trigger 翻译(Step 4 再做)。
 */

import type { CliProfile, CliTriggerSpec } from "@kernel/cli";

/**
 * 在 text 里找出现在光标位置之上(整段都算)"最靠近光标"的 trigger token。
 * token 形态: char 后面到空格/末尾/逗号为止。
 *
 * @returns { spec, range:[startIndex, endIndex) } 或 null
 */
export function findActiveTrigger(
  text: string,
  cursor: number,
  triggers: readonly CliTriggerSpec[],
): { spec: CliTriggerSpec; range: [number, number] } | null {
  const before = text.slice(0, cursor);
  for (const spec of triggers) {
    const char = spec.char;
    // 找最后一个 char,后面没到空格/换行
    let lastIdx = -1;
    for (let i = before.length - 1; i >= 0; i--) {
      if (before[i] === char) {
        lastIdx = i;
        break;
      }
      if (/\s/.test(before[i])) break;
    }
    if (lastIdx < 0) continue;
    const endIdx = cursor;
    const token = before.slice(lastIdx);
    // 必须以 char 开头(避免找到 @ 之前的字符)
    if (token[0] !== char) continue;
    return { spec, range: [lastIdx, endIdx] };
  }
  return null;
}

/**
 * 把 prompt 走 CLI profile 的 translate 钩子全量变换。
 * 没声明 translate = 原样透传。
 */
export function translatePrompt(profile: CliProfile, text: string): string {
  const triggers = profile.triggers;
  if (triggers.every((t) => !t.translate)) return text;
  // 用 token+regex 贪婪扫;字符都放在 split 边界
  // 简化:对每个有 translate 的触发符,按字符拆分做替换
  return triggers.reduce((acc, spec) => {
    if (!spec.translate) return acc;
    const char = spec.char.replace(/[-\\^$*+?.()|[\]{}]/g, "\\$&");
    return acc.replace(new RegExp(`${char}\\S+`, "g"), (match) =>
      spec.translate!(match),
    );
  }, text);
}

/**
 * 写入 PTY 之前的最终文本。v1 不用 bracketed paste(交给 CLI 自己处理粘贴)。
 */
export function prepareSendPayload(
  profile: CliProfile,
  text: string,
): string {
    // TUI 应用(omp/pi/codex)期待 CR 作 Enter 键 — LF 不会被识别为"提交"
  return translatePrompt(profile, text) + "\r";
}
