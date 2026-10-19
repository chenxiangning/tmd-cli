/**
 * docgen 磁盘布局与 io 原语(插件私有;路径根 = ipc.configDir() → ~/.tmd-cli)。
 *
 * 布局(spec 2026-10-11-docgen-loop-design.md):
 * - workbench/docgen/docgen.json          索引(条目元数据+排程+队列截尾)
 * - workbench/docgen/docs/<id>/v<N>.md    版本链实体(生成会话直写,落盘即结算信号)
 * - workbench/docgen/docs/<id>/prompt-latest.md  本次生成 prompt(@file 传入引擎)
 *
 * 与项目资料文档(docs/project-<id>/)物理分档:流水线产物不混用户资产。
 * io 语义与 journalFiles 同款:readText 缺失回 null、writeText 走原子写后端。
 */
import { ipc } from "@kernel/ipc";
import { ensureDir, ensureParentDir } from "@kernel/fsDirs";
import { EMPTY_DOCGEN_INDEX, type DocGenIndexFile } from "./types";

export const DOCGEN_INDEX_VERSION = 1;
/** 索引写闸(条目元数据轻,496KB 同 workbench index 口径)。 */
const MAX_INDEX_BYTES = 496 * 1024;

interface DocGenPaths {
  root: string;
  index: string;
  docsDir: string;
  /** 版本实体路径(生成会话结算目标;轮询与 fileEditDetected 都认它)。 */
  version: (entryId: string, v: number) => string;
  prompt: (entryId: string) => string;
}

let pathsLoading: Promise<DocGenPaths> | null = null;

/** 全路径(模块级缓存;configDir 每进程恒定)。微任务包一层防无 Tauri 环境同步 throw。 */
export function docgenPaths(): Promise<DocGenPaths> {
  pathsLoading ??= Promise.resolve().then(() => ipc.configDir()).then((base) => {
    const root = `${base}/workbench/docgen`;
    return {
      root,
      index: `${root}/docgen.json`,
      docsDir: `${root}/docs`,
      version: (entryId: string, v: number) => `${root}/docs/${entryId}/v${v}.md`,
      prompt: (entryId: string) => `${root}/docs/${entryId}/prompt-latest.md`,
    };
  });
  return pathsLoading;
}

/** 读索引;缺失/损坏回默认(数据文件宽容读;configDir 不可用(桩/单测)同兜底)。 */
export async function readDocGenIndex(): Promise<DocGenIndexFile> {
  const p = await docgenPaths().catch(() => null);
  if (!p) return EMPTY_DOCGEN_INDEX;
  try {
    const raw = JSON.parse(await ipc.fsReadFile(p.index)) as Partial<DocGenIndexFile>;
    if (!Array.isArray(raw.entries)) return EMPTY_DOCGEN_INDEX;
    return {
      version: DOCGEN_INDEX_VERSION,
      entries: raw.entries,
      schedule: raw.schedule ?? EMPTY_DOCGEN_INDEX.schedule,
      tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
    };
  } catch {
    return EMPTY_DOCGEN_INDEX;
  }
}

/** 写索引(超闸拒绝,防 AI 会话误写撑爆);调用方负责失败回滚内存态。 */
export async function writeDocGenIndex(data: DocGenIndexFile): Promise<void> {
  const p = await docgenPaths();
  const content = JSON.stringify(data, null, 1);
  if (new TextEncoder().encode(content).byteLength > MAX_INDEX_BYTES) {
    throw new Error("docgen 索引超过 496KB,拒绝写入;请清理历史文档记录。");
  }
  await ensureDir(p.root); /* 目录本身要建;ensureParentDir 只建到 workbench,docgen 缺席 = 写入 ENOENT(真实机实测) */
  await ipc.fsWriteFile(p.index, content);
}

/** 读文本;不存在返回 null(版本存在性判定)。 */
export async function readText(path: string): Promise<string | null> {
  try {
    return await ipc.fsReadFile(path);
  } catch {
    return null;
  }
}

/** 导出文件名基础名清洗:Windows 保留设备名(含「保留名+扩展名」形态,首点前
 *  主干判,CON.md.md 仍落设备)禁写,命中主干前缀 _;其余平台无害。
 *  docgen 导出与 session-viewer 转录导出共用。 */
export function safeFileBase(base: string): string {
  return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i.test(base) ? `_${base}` : base;
}

/** 落盘(fsWriteFile 后端已 tmp+rename 原子替换;文件路径走父目录原语)。 */
export async function writeText(path: string, content: string): Promise<void> {
  await ensureParentDir(path);
  await ipc.fsWriteFile(path, content);
}

/** 删条目实体目录(终止首版未产出时清孤儿;含 prompt-latest.md)。
 *  entryId 白名单:索引数据被污染时防 `../` 借删除原语越出 docsDir。 */
export async function removeEntryDir(entryId: string): Promise<void> {
  if (!/^[\w-]+$/.test(entryId)) throw new Error(`docgen: 非法条目 id「${entryId.slice(0, 32)}」`);
  const p = await docgenPaths();
  await ipc.fsRemovePath(`${p.docsDir}/${entryId}`);
}
