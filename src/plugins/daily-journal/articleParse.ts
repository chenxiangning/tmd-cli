/**
 * 文章 md → 展示模型解析(纯函数;生成 prompt 固化同款契约,见 spec)。
 *
 * 契约(宽松解析,缺件均可渲染):
 * - 首个 `# ` 行 = 标题;首个 `## ` 前的非空行段 = 总览(lede);
 * - `## 未完事项`(或 开放事项/待办)= open 列表(`- ` 行);
 * - 其余 `## ` = 分节;节标题行尾 `(HH:MM 并入)` = 增量留痕章(inc);
 * - 代码围栏内不识别标题。
 */
export interface ArticleSection {
  title: string;
  /** 增量并入留痕(HH:MM;首次生成无)。 */
  inc?: string;
  /** 节正文(原样 md 行,渲染层按行展示)。 */
  body: string[];
}

export interface Article {
  title: string;
  lede: string;
  secs: ArticleSection[];
  open: string[];
}

const H1_RE = /^#\s+(.*)$/;
const H2_RE = /^##\s+(.*)$/;
const INC_RE = /[（([]\s*(\d{1,2}:\d{2})\s*并入\s*[)）]\s*$/;
const OPEN_RE = /^(未完事项|开放事项|待办事项|未完|Open items?)\s*[：:]?\s*$/i;
const LI_RE = /^[-*]\s+(.*)$/;

/** 解析失败(空文本/无 h1/无任何节)返回 null —— 调用方按「文章不存在」处理。 */
export function parseArticle(md: string): Article | null {
  const lines = md.split(/\r?\n/);
  let title: string | null = null;
  const ledeLines: string[] = [];
  const secs: ArticleSection[] = [];
  let open: string[] | null = null;
  let cur: { sec: ArticleSection | null; list: string[] | null } = { sec: null, list: null };
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      cur.sec?.body.push(line);
      cur.list?.push(line);
      continue;
    }
    if (!inFence) {
      const h1 = H1_RE.exec(line);
      if (h1 && title === null) {
        title = h1[1].trim();
        continue;
      }
      const h2 = H2_RE.exec(line);
      if (h2) {
        const head = h2[1].trim();
        if (OPEN_RE.test(head)) {
          open = [];
          cur = { sec: null, list: open };
          continue;
        }
        const inc = INC_RE.exec(head);
        const sec: ArticleSection = {
          title: inc ? head.slice(0, inc.index).trim() : head,
          ...(inc ? { inc: inc[1] } : {}),
          body: [],
        };
        secs.push(sec);
        cur = { sec, list: null };
        continue;
      }
      const li = LI_RE.exec(line);
      if (li && cur.list) {
        cur.list.push(li[1].trim());
        continue;
      }
    }
    if (cur.sec) cur.sec.body.push(line);
    else if (title !== null && !cur.list) ledeLines.push(line);
  }
  if (title === null) return null;
  const lede = ledeLines.join("\n").trim();
  if (!lede && secs.length === 0 && !open) return null;
  return { title, lede, secs, open: open ?? [] };
}

/** 便签随手短行:单换行在 md 里是软断(挤同行),view 侧转 CommonMark 硬断;存储保持 verbatim。 */
export function noteMd(text: string): string {
  return text.replace(/(?<!\n)\n(?!\n)/g, "  \n");
}
