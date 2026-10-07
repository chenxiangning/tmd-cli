/**
 * 文章本体渲染件(文章 tab 与轴视图卡共用):总览段 + 分节(并入留痕章)+
 * 未完事项 + 只读便签卡。纯展示,无数据依赖。
 */
import { useEffect, useState } from "react";
import { t } from "@kernel/i18n";
/* 跨插件 UI 复用先例(同 session-viewer→files):纯 props 渲染件,不涉
   session-viewer 生命周期;日报正文是 agent 写的 markdown,须按 md 渲染。 */
import { MarkdownBody } from "@plugins/session-viewer/markdownBody";
import type { Article } from "./articleParse";
import { noteMd } from "./articleParse";
import { sessionKeyFromHref, withSessionLinks } from "./sessionRef";
import type { DayNote, DayNoteImage, JournalBead } from "./journalFiles";
import { loadNoteImage, noteImageUrl } from "./noteAssets";
/** 会话引用面(可选):ArticleTab 注入当日行集 —— 命中标记转链接,点击回调
 *  open(归一键);未注入(轴视图卡等)标记降级纯文本。 */
export interface SessionLinkHost {
  isValid: (key: string) => boolean;
  open: (key: string) => void;
}

export function ArticleBody({ article, sessionLinks }: { article: Article; sessionLinks?: SessionLinkHost }) {
  /* 链接点击走事件委托:react-markdown 产 <a href="#tmd-sess-…">,容器统一
   *  截获还原归一键 → open;MarkdownBody 组件零改动。 */
  const onBodyClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (!sessionLinks) return;
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    const key = sessionKeyFromHref(a.getAttribute("href") ?? "");
    if (key === null) return;
    e.preventDefault();
    sessionLinks.open(key);
  };
  /* 恒跑标记处理:有 host = 链接化;无 host(轴视图卡)= 降级纯文本标题,
   * 裸标记语法永不外露。lede 是纯文本节点,恒降级。 */
  const transform = (md: string): string => withSessionLinks(md, sessionLinks?.isValid ?? (() => false));
  return (
    // eslint-disable-next-line react-doctor/click-events-have-key-events, react-doctor/no-static-element-interactions -- 键盘可达性由真实 <a> 承担(Tab+Enter 原生);div 仅点击截获转译,非独立交互元素
    <div className="dj-art-body" onClick={sessionLinks ? onBodyClick : undefined}>
      {article.lede && <p className="dj-art-lede">{withSessionLinks(article.lede, () => false)}</p>}
      {article.secs.map((sec) => (
        <section key={`${sec.title}-${sec.inc ?? ""}`} className="dj-asec">
          <div className="dj-asec-top">
            <span className="dj-asec-t">{sec.title}</span>
            {sec.inc && <span className="dj-incb">{t("{t} 并入", { t: sec.inc })}</span>}
          </div>
          {/* body 原样 join(空白行保留 = md 段落边界;fence 已由解析器保真) */}
          <MarkdownBody>{transform(sec.body.join("\n"))}</MarkdownBody>
        </section>
      ))}
      {article.open.length > 0 && (
        <div className="dj-openbox">
          <h4>{t("未完事项")}</h4>
          <ul>
            {article.open.map((o, j) => (
              /* 未完事项是纯文本节点:标记一律降级标题文本(链接只在 md 正文) */
              <li key={`${j}-${o}`}>{withSessionLinks(o, () => false)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** 附件缩略图(懒加载 data URL;editing 时 hover 出删除位)。 */
export function NoteImage({
  img,
  editing,
  onDelete,
  onOpen,
}: {
  img: DayNoteImage;
  editing?: boolean;
  onDelete?: () => void;
  onOpen?: () => void;
}) {
  const [url, setUrl] = useState(() => noteImageUrl(img.file));
  useEffect(() => {
    if (!url) void loadNoteImage(img.file).then(setUrl);
  }, [img.file, url]);
  if (!url) return null;
  return (
    <div className="dj-nc-img" title={img.name}>
      {onOpen ? (
        <button type="button" className="dj-nc-img-open" aria-label={img.name} onClick={onOpen}>
          <img src={url} alt={img.name} />
        </button>
      ) : (
        <img src={url} alt={img.name} />
      )}
      {editing && onDelete && (
        <button type="button" className="dj-nc-img-del" aria-label={t("移除图片")} onClick={onDelete}>
          ×
        </button>
      )}
    </div>
  );
}

export function NoteReadonly({ note, onImageOpen }: { note: DayNote; onImageOpen?: (img: DayNoteImage) => void }) {
  return (
    <div className="dj-notecard-readonly">
      <div className="dj-nc-head">{t("我的便签")}</div>
      {note.text && (
        <div className="dj-nc-text">
          {/* 便签与文章同管线按 md 渲染;存储 verbatim,硬断是 view 侧转换 */}
          <MarkdownBody>{noteMd(note.text)}</MarkdownBody>
        </div>
      )}
      {note.images.length > 0 && (
        <div className="dj-nc-imgs">
          {note.images.map((img) => (
            <NoteImage key={img.file} img={img} onOpen={onImageOpen ? () => onImageOpen(img) : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 生长珠子带:一次生成/增量/干涉一颗,相对定位悬停出时点与说明。 */
export function BeadStrip({ beads }: { beads: JournalBead[] }) {
  if (beads.length === 0) return null;
  const n = beads.length;
  return (
    <div className="dj-grow">
      <span>{t("生长 {n} 次", { n })}</span>
      <div className="dj-grow-line">
        {beads.map((b, i) => (
          <span key={`${b.t}-${i}`} className="dj-gbead" style={{ left: `${((i + 0.5) / n) * 100}%` }}>
            <span className="dj-gbead-tip">
              {b.t} · {b.label}
            </span>
          </span>
        ))}
      </div>
      <span className="dj-grow-last">{beads[n - 1].t}</span>
    </div>
  );
}

/** 大图查看(Esc / 点击遮罩关闭;IME 组词期放行)。 */
export function Lightbox({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  return (
    <button
      type="button"
      className="dj-lightbox"
      aria-label={t("关闭大图")}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.nativeEvent.isComposing) onClose();
      }}
    >
      <img src={url} alt={name} />
      <span className="dj-lightbox-cap">{name}</span>
    </button>
  );
}

