/**
 * 文章会话引用标记(纯函数)—— 生成契约的四段标记与渲染层的解析/校验两端。
 *
 * 契约(promptGen 同步表述):正文提到具体会话时行内输出
 *   [会话|HH:MM|profileId|标题]
 * 四段与当日会话清单行同源(时刻=清单起始时刻)。渲染层只把**与清单完全一致**
 * 的标记转成可点链接(枚举校验,宁缺勿错);不一致(含 LLM 编造)降级纯文本标题。
 */
import { host } from "@kernel/host";
import { KernelTopics } from "@kernel/events";
import { requestSessionReveal } from "@kernel/sessionReveal";
import { isSessionViewAvailable, openSessionViewTab } from "@kernel/sessionViewTabs";
import { hmOf } from "./timeUtil";
import type { DaySessionRow } from "./daySessions";
import type { SessionLinkHost } from "./articleBody";

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

/** 单行打开(PTY 语义):live 聚焦终端 / disk 磁盘续开;工作区已删不续。
 *  文章标记链接与当日清单行链接共用。 */
export function openDaySessionRow(
  r: DaySessionRow,
  workspaces: readonly { id: string; root: string }[],
): void {
  if (r.live && r.id) {
    host.events.emit(KernelTopics.sessionViewRequested, null); /* 用户手势,摘最大化(与 disk 分支同口径,M12) */
    requestSessionReveal(r.id);
  } else if (r.disk) {
    const ws = workspaces.find((w) => w.id === r.wsId);
    /* 工作区已删(扫描缓存 60s 窗内):空 cwd 只会在 app 目录开垃圾会话,不续。 */
    if (!ws) return;
    host.events.emit(KernelTopics.sessionViewRequested, null); /* 用户手势,摘最大化 */
    void host.openDiskSession(r.profileId, ws.root, ws.id, r.disk.id);
  }
}

/** 转录查看深链(与打开会话同源寻址):引擎支持转录 + 查看器在册才产出回调,
 *  否则 undefined(调用方隐藏入口)。文章 tab 当日清单与 footprint 降级清单共用。 */
export function daySessionViewOpener(
  r: DaySessionRow,
  workspaces: readonly { id: string; root: string }[],
): (() => void) | undefined {
  const profile = host.getCliProfile(r.profileId);
  const cliSessionId = r.disk?.id ?? (r.id !== undefined ? host.getCliSessionId(r.id) : undefined);
  if (!profile?.readSessionTranscript || !isSessionViewAvailable() || !cliSessionId) return undefined;
  const ws = workspaces.find((w) => w.id === r.wsId);
  const cwd = r.live && r.id ? host.getSessions().find((s) => s.id === r.id)?.cwd : ws?.root;
  return () =>
    openSessionViewTab({
      profileId: r.profileId, cliSessionId, title: r.title,
      path: r.disk?.path, cwd,
    });
}

/** 当日行集 → 链接面(四段归一键寻址:live 续聊聚焦 / disk 磁盘续开)。
 *  从 ArticleTab 拆出守组件复杂度;host/requestSessionReveal 为模块级稳定引用。 */
export function buildSessionLinks(
  rows: readonly DaySessionRow[] | null,
  workspaces: readonly { id: string; root: string }[],
): SessionLinkHost | undefined {
  if (!rows || rows.length === 0) return undefined;
  const byKey = new Map(rows.map((r) => [sessionRefKey(hmOf(r.startedAt), r.profileId, r.title), r]));
  return {
    isValid: (k: string) => byKey.has(k),
    open: (k: string) => {
      const r = byKey.get(k);
      if (r) openDaySessionRow(r, workspaces);
    },
  };
}
