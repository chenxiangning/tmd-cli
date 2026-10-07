/**
 * 转录块压缩原语 ── 角色化单行摘录 + 双层预算(kernel 通用层)。
 *
 * 输入是 kernel 统一 CliTranscriptBlock(各 CLI 插件声明的 readSessionTranscript
 * 适配器产物),不含任何 CLI 私有格式知识。消费先例:
 * - daily-journal 会话摘录(每日文章事实来源,sessionDigest.ts 装配小节头);
 * - session-relay 跨引擎接力摘要(relay.ts 装配首尾行,预算独立常量)。
 *
 * 压缩纪律:reasoning/system 丢弃;user/assistant 压单行保头截断;tool 压单行
 * (失败态升格「报错」行,附 detail;适配器词表 error/failed);会话级字符预算
 * 截断时保底追加末条助手结论(收尾结论是接力/成文最贵的证据)。
 */
import type { CliTranscriptBlock } from "./cli";

/** 摘录层默认预算(user 原话最贵给足,tool 只留指纹;接力摘要用独立常量覆写)。 */
export const DIGEST_CAPS: DigestCaps = { user: 800, assistant: 600, tool: 160, session: 4000 };

/** 单块与会话级截断预算(字符)。 */
export interface DigestCaps {
  user: number;
  assistant: number;
  tool: number;
  session: number;
}

/** 任意文本 → 单行安全摘录(空白折叠 + 保头截断);md 结构符随单行化失效。 */
export function capLine(text: string, n: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= n) return one;
  /* 截点落在代理对中间时回退一位:劈开的半个字符进提示词会被目标引擎解析成
     坏码点(session-relay 旧 truncateItem 同 bug 修法投迁,行为只增强不回退)。 */
  let cut = one.slice(0, n);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut}…(截断)`;
}

/** 单块 → 一行摘录;非内容块返回 null。 */
function blockLine(b: CliTranscriptBlock, caps: DigestCaps): string | null {
  const text = b.text.trim();
  if (b.role === "user" && text) return `用户:${capLine(text, caps.user)}`;
  if (b.role === "assistant" && text) return `助手:${capLine(text, caps.assistant)}`;
  if (b.role === "tool") {
    const title = (b.tool?.title || text).trim();
    if (!title) return null;
    /* 失败词表取适配器实产:error(部分家族)/failed(opencode 系透传)。 */
    const failed = b.tool?.status === "error" || b.tool?.status === "failed";
    const head = failed ? "报错" : "动作";
    const detail = failed && b.tool?.detail ? ` — ${capLine(b.tool.detail, caps.tool)}` : "";
    return `${head}:${capLine(title, caps.tool)}${detail}`;
  }
  return null;
}

/** 摘录产物:行列表 + 截断标记(调用方明示,不让读者误以为全文都在)。 */
export interface TranscriptDigest {
  lines: string[];
  truncated: boolean;
}

/** 块列表 → 角色化行摘录(会话预算内顺序收录,超限截断保末条助手结论)。
 *  无任何内容块返回 null(调用方按仅标题/诚实占位处理)。 */
export function renderTranscriptDigest(
  blocks: readonly CliTranscriptBlock[],
  caps: DigestCaps,
): TranscriptDigest | null {
  const lines: string[] = [];
  let used = 0;
  let cut = false;
  /* 先全量定位真正末条助手结论:预算截断后循环到不了它,而它恰是收尾最贵证据。 */
  let lastAssistant: string | null = null;
  for (const b of blocks) {
    if (b.role === "assistant" && b.text.trim()) lastAssistant = b.text.trim();
  }
  for (const b of blocks) {
    const line = blockLine(b, caps);
    if (line === null) continue;
    if (used + line.length > caps.session) {
      cut = true;
      break;
    }
    lines.push(line);
    used += line.length;
  }
  if (lines.length === 0) return null;
  /* 截断保底:末条助手结论(常含最终结论/复盘)不在预算内时补一行尾摘。 */
  if (cut && lastAssistant) {
    const tail = `助手(结尾):${capLine(lastAssistant, 400)}`;
    if (!lines.includes(`助手:${capLine(lastAssistant, caps.assistant)}`)) lines.push(tail);
  }
  if (cut) lines.push("(摘录超预算,后续内容省略)");
  return { lines, truncated: cut };
}
