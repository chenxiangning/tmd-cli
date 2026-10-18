/**
 * 会话转录 → Markdown 导出纯函数(候选7,node 可测)。
 * 结构:# 标题(缺省会话 id)+ 元信息行(引擎/导出时间/块数)+ 截断标注;
 * 正文按角色映射:user/assistant 二级标题、tool 折叠一行引用;
 * thinking(system)过程块与内嵌图片不导出,仅计数随 toast 汇报
 * (会话原文仍在客户端,md 面向归档/检索)。
 * 文件名助手 sessionExportFileName:`<标题slug>-<YYYYMMDD>.md`,
 * Windows 保留名清洗复用 docgen/paths 的 safeFileBase(两处导出同一约定)。
 */
import type { CliSessionTranscript } from "@kernel/cli";
import { safeFileBase } from "@plugins/workbench/docgen/paths";

/** 导出元信息(标题缺省回会话 id;exportedAt 缺省 now,测试注入用)。 */
export interface ExportMeta {
  title?: string;
  cliSessionId: string;
  profileId: string;
  exportedAt?: number;
}

/** 导出结果:markdown 全文 + 计数(toast 口径;N = 导出块数)。 */
export interface MarkdownExport {
  markdown: string;
  /** 导出的块数(user + assistant + tool)。 */
  blocks: number;
  /** 跳过的过程块数(reasoning/system)。 */
  skippedThinking: number;
  /** 跳过的内嵌图片数。 */
  skippedImages: number;
}

/** 导出文件名:`<标题slug>-<YYYYMMDD>.md`;标题缺省回会话 id。 */
export function sessionExportFileName(
  title: string | undefined,
  cliSessionId: string,
  now = new Date(),
): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const day = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
  /* slug:文件系统非法字符 → _;封顶 80 字符(标题可能是整段首问,防超长文件名)。 */
  const slug = (title || cliSessionId).replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
  return `${safeFileBase(slug)}-${day}.md`;
}

/** 元信息行本地时间戳:YYYY-MM-DD HH:mm。 */
function stamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 转录 → Markdown。纯函数;节间空行,零 emoji。 */
export function blocksToMarkdown(
  transcript: CliSessionTranscript,
  meta: ExportMeta,
): MarkdownExport {
  const parts: string[] = [
    `# ${meta.title || meta.cliSessionId}`,
    `引擎 ${meta.profileId} · 导出时间 ${stamp(meta.exportedAt ?? Date.now())} · 块数 ${transcript.blocks.length}`,
  ];
  if (transcript.truncated) parts.push("> 源超预算,导出为截断版");

  let blocks = 0;
  let skippedThinking = 0;
  let skippedImages = 0;
  const body: string[] = [];
  for (const block of transcript.blocks) {
    /* 过程块(thinking/system)不导出只计数;system 现仅 live reducer 产出,
     * 磁盘转录实证无此角色,防御性并入同一计数。 */
    if (block.role === "reasoning" || block.role === "system") {
      skippedThinking++;
      continue;
    }
    skippedImages += block.images?.length ?? 0;
    if (block.role === "tool") {
      blocks++;
      body.push(`> [工具] ${block.tool?.title ?? "tool"}`);
      continue;
    }
    const text = block.text.trim();
    if (!text) continue; /* 纯图片/空正文块:标题不落空节 */
    blocks++;
    body.push(block.role === "user" ? `## 用户\n\n${text}` : `## 助手\n\n${text}`);
  }
  return { markdown: [...parts, ...body].join("\n\n"), blocks, skippedThinking, skippedImages };
}
