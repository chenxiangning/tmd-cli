/**
 * 文章会话引用标记(纯函数)—— 生成契约的四段标记与渲染层的解析/校验两端。
 *
 * 契约(promptGen 同步表述):正文提到具体会话时行内输出
 *   [会话|HH:MM|profileId|标题]
 * 四段与当日会话清单行同源(时刻=清单起始时刻)。渲染层只把**与清单完全一致**
 * 的标记转成可点链接(枚举校验,宁缺勿错);不一致(含 LLM 编造)降级纯文本标题。
 */
export const SESSION_REF_RE = /\[会话\|([0-9]{2}:[0-9]{2})\|([^|\]\n]+)\|([^|\]\n]+)\]/g;

/** 标记归一键(校验集合与点击回调的统一寻址)。 */
export function sessionRefKey(hm: string, profileId: string, title: string): string {
  return `${hm}|${profileId}|${title}`;
}

/** 链接 href 前缀(点击委托只认此前缀的锚点)。 */
export const SESSION_LINK_PREFIX = "#tmd-sess-";

/**
 * md 正文标记 → 链接(md 文本变换,MarkdownBody 零改动):
 * - isValid 命中:`[会话|a|b|c]` → `[c](#tmd-sess-<encodeURIComponent(key)>)`
 * - 未命中(编造/漂移):降级为纯文本 `c`(标记语法不外露)。
 */
export function withSessionLinks(
  md: string,
  isValid: (key: string) => boolean,
): string {
  return md.replace(SESSION_REF_RE, (_all, hm: string, profileId: string, title: string) => {
    const key = sessionRefKey(hm, profileId, title);
    if (!isValid(key)) return title; /* 降级纯文本标题,标记语法不外露 */
    /* md 转义:标题可含 []() 字符 —— 链接文本转义方括号/反斜杠;href 里
     * encodeURIComponent 不编码括号,裸 () 会提前终结 inline destination。 */
    const text = title.replace(/[[\]\\]/g, "\\$&");
    const href = encodeURIComponent(key).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    return `[${text}](${SESSION_LINK_PREFIX}${href})`;
  });
}

/** 从锚点 href 还原归一键;非本标记前缀或坏编码返回 null(宁缺勿错)。 */
export function sessionKeyFromHref(href: string): string | null {
  if (!href.startsWith(SESSION_LINK_PREFIX)) return null;
  try {
    return decodeURIComponent(href.slice(SESSION_LINK_PREFIX.length));
  } catch {
    return null;
  }
}
