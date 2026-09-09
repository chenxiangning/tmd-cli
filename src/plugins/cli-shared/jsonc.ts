/**
 * 最小 JSONC 归一 —— 剥离 // 与 块注释、尾逗号,字符串字面量原样保留。
 *
 * cli-shared 准入先例(文件头声明):cli-pi 消费 pi models.json(JSONC),
 * feature 插件 memory-coordinator 消费 magic-context.jsonc(引擎配置卡),
 * 同一份「CLI 配置文件的 JSONC 方言」知识,联合消费故落此层。
 * 实证只有这两种非标准语法,不引入第三方解析器。
 */

/** 归一后 JSON.parse;输入非法时抛错(调用方按需 catch)。 */
export function parseJsonc(raw: string): unknown {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < raw.length && raw[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < raw.length && !(raw[i] === "*" && raw[i + 1] === "/")) i++;
      i++;
      continue;
    }
    out += ch;
  }
  // 尾逗号: , 后直接跟 } 或 ](允许中间空白)
  const noTrailing = out.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(noTrailing);
}

/** 容错变体:解析失败回 null(配置卡等「读不到就当空」场景)。 */
export function parseJsoncOrNull(text: string): Record<string, unknown> | null {
  try {
    const parsed = parseJsonc(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
