/**
 * 工作台 · 磁盘文件面:`~/.tmd-cli/workbench/` 布局:
 * - index.json            项目元数据(含任务/进展/文档与附件的轻元数据)
 * - docs/project-<id>/*   文档与附件实体文件(markdown/图片/任意文件)
 * - AI-TASKS.md           AI 回写任务状态的文件规则(让 AI 本地改任务信息)
 * 读写守闸:索引 496KB 写闸(读闸 512KB);附件上传 24MB 前端闸(Rust 32MB)。
 * 自 store.ts 拆出守 300 行铁则。
 */

import { ipc } from "@kernel/ipc";
import { ensureDir } from "@kernel/fsDirs";
import type { Project, ProjectDoc } from "./types";

export const INDEX_VERSION = 2;
const MAX_INDEX_BYTES = 496 * 1024;
export const PROJECT_ID_PATTERN = /^p-[A-Za-z0-9._-]+$/;
const INDEX_FILE = "index.json";
export const AI_RULES_FILE = "AI-TASKS.md";

export const INDEX_PATH = (home: string) => `${home}/.tmd-cli/workbench/${INDEX_FILE}`;
export const PROJECT_PATH = (home: string, id: string) => `${home}/.tmd-cli/workbench/project-${id}.json`;
/** 文档/附件实体目录(文件名带归属前缀防撞)。 */
export const DOCS_DIR = (home: string, projectId: string) => `${home}/.tmd-cli/workbench/docs/project-${projectId}`;
export const DOC_FILE = (home: string, projectId: string, fileName: string) =>
  `${DOCS_DIR(home, projectId)}/${fileName}`;

export function createProjectId(): string {
  const rand = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `p-${Date.now().toString(36)}-${rand}`;
}

export function isMissingFileError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("not found") || message.includes("no such file") || message.includes("does not exist")
    || message.includes("os error 2") || message.includes("cannot find") || message.includes("找不到")
  );
}

const SAFE_EXT = /\.[A-Za-z0-9]{1,8}$/;

/** File → base64(32KB 分块拼串,btoa;上传附件/图片共用)。 */
export function fileToBase64(file: File): Promise<{ bytesBase64: string; size: number }> {
  return file.arrayBuffer().then((buffer) => {
    let binary = "";
    const view = new Uint8Array(buffer);
    for (let i = 0; i < view.length; i += 0x8000) {
      binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
    }
    return { bytesBase64: btoa(binary), size: file.size };
  });
}

/** 附件磁盘名(只保留安全扩展,内容 id 化防路径注入)。 */
export function safeAttachFileName(attId: string, name: string): string {
  const ext = SAFE_EXT.exec(name)?.[0]?.toLowerCase() ?? "";
  return `${attId}${ext}`;
}

/** 图片附件判定(点按预览);其余附件直开文件 tab。 */
export function isImageAttachment(fileName: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(fileName);
}

/** 附件的磁盘绝对路径(.tmd-cli/workbench/docs/project-<id>/<fileName>)。 */
export async function docAttachmentPath(projectId: string, fileName: string): Promise<string> {
  return DOC_FILE(await ipc.configHomeDir(), projectId, fileName);
}

/** index 落盘形态(docs 元数据轻;不落 content 内存字段)。 */
type IndexProject = Omit<Project, "docs"> & { docs: Array<Omit<ProjectDoc, "content">> };

function toIndexProject(project: Project): IndexProject {
  const { docs, ...rest } = project;
  return { ...rest, docs: docs.map(({ content: _content, ...meta }) => meta) };
}

/** 读 index;缺失(首用)返回 null,损坏或形状不符上抛(静默回 [] 会在首次
 *  变更时覆写外部数据,必须走错误条让人看见)。 */
export async function readIndexFile(): Promise<IndexProject[] | null> {
  const home = await ipc.configHomeDir();
  try {
    const raw = JSON.parse(await ipc.fsReadFile(INDEX_PATH(home))) as { projects?: unknown };
    if (!Array.isArray(raw?.projects)) throw new Error("workbench index:projects 形状不符");
    return raw.projects as IndexProject[];
  } catch (e) {
    if (isMissingFileError(e)) return null;
    throw e;
  }
}

export async function writeIndexFile(projects: readonly Project[]): Promise<void> {
  const home = await ipc.configHomeDir();
  const content = JSON.stringify({ version: INDEX_VERSION, projects: projects.map(toIndexProject) }, null, 2);
  if (new TextEncoder().encode(content).byteLength > MAX_INDEX_BYTES) {
    throw new Error("工作台索引超过 496KB,拒绝写入;请清理部分项目或缩短进展记录。");
  }
  await ensureDir(`${home}/.tmd-cli/workbench`);
  await ipc.fsWriteFile(INDEX_PATH(home), content);
}

/** 读某项目旧版 PRD 分文件(迁移源;缺 = undefined)。 */
export async function readLegacyPrd(id: string): Promise<string | undefined> {
  const home = await ipc.configHomeDir();
  try {
    const detail = JSON.parse(await ipc.fsReadFile(PROJECT_PATH(home, id))) as { markdown?: unknown };
    return typeof detail.markdown === "string" ? detail.markdown : undefined;
  } catch (e) {
    if (isMissingFileError(e)) return undefined;
    throw e;
  }
}

export async function removeLegacyPrd(id: string): Promise<void> {
  const home = await ipc.configHomeDir();
  await ipc.fsRemovePath(PROJECT_PATH(home, id)).catch(() => undefined);
}

/** 读文档/附件实体文本(markdown;缺 = null)。 */
export async function readDocText(projectId: string, fileName: string): Promise<string | null> {
  const home = await ipc.configHomeDir();
  try {
    return await ipc.fsReadFile(DOC_FILE(home, projectId, fileName));
  } catch (e) {
    if (isMissingFileError(e)) return null;
    throw e;
  }
}

/** 读附件/图片为 data URL(预览;缺 = null)。 */
export async function readDocDataUrl(projectId: string, fileName: string): Promise<string | null> {
  const home = await ipc.configHomeDir();
  try {
    const base64 = await ipc.fsReadBytesBase64(DOC_FILE(home, projectId, fileName));
    const mime = /\.(png|jpe?g|gif|webp|svg)$/i.exec(fileName)?.[1]?.toLowerCase();
    const type = mime === "svg" ? "image/svg+xml" : mime ? `image/${mime === "jpg" ? "jpeg" : mime}` : "application/octet-stream";
    return `data:${type};base64,${base64}`;
  } catch (e) {
    if (isMissingFileError(e)) return null;
    throw e;
  }
}

export async function writeDocFile(projectId: string, fileName: string, content: string): Promise<void> {
  const home = await ipc.configHomeDir();
  await ensureDir(DOCS_DIR(home, projectId));
  await ipc.fsWriteFile(DOC_FILE(home, projectId, fileName), content);
}

export async function writeDocBytes(projectId: string, fileName: string, base64: string): Promise<void> {
  const home = await ipc.configHomeDir();
  await ensureDir(DOCS_DIR(home, projectId));
  await ipc.fsWriteBytesBase64(DOC_FILE(home, projectId, fileName), base64);
}

export async function removeDocFile(projectId: string, fileName: string): Promise<void> {
  const home = await ipc.configHomeDir();
  await ipc.fsRemovePath(DOC_FILE(home, projectId, fileName)).catch(() => undefined);
}

/** AI 回写任务状态的文件规则(幂等;已存在则不动)。 */
export async function ensureAiRulesFile(indexPath: string): Promise<void> {
  const exists = await ipc.fsReadFile(indexPath).then(
    () => true,
    (e) => {
      if (isMissingFileError(e)) return false;
      throw e;
    },
  );
  if (exists) return;
  await ipc.fsWriteFile(indexPath, AI_RULES_CONTENT);
}

const AI_RULES_CONTENT = `# 工作台任务数据 · AI 回写规则

本文件供 AI 会话参考:当用户要求你更新工作台任务状态时,按以下规则直接修改数据文件。

## 数据位置

- 项目索引:\`index.json\`(与本文件同目录),结构 \`{ version: 2, projects: [...] }\`。
- 每个任务在 \`projects[].tasks[]\` 中,以 \`id\`(如 \`t-xxxx\`)唯一定位。

## 允许 AI 修改的字段(仅限被明确要求的任务)

- \`status\`:\`"todo" | "doing" | "done"\`
- \`doneAt\`:置 done 时写 ISO 时间戳;回退 todo/doing 时删除该字段
- \`updatedAt\`:每次修改写当前 ISO 时间戳

## 禁止修改

任务标题/负责人/日期/描述/附件/会话关联、项目级任何字段、其他任务的任何字段、
\`docs[]\` 与 \`updates[]\`。除非用户明确要求,否则不要新增或删除任务。

## 写入方式

整文件 JSON 重写(\`index.json\` 保持合法 JSON、2 空格缩进);写入前确认读到的
\`version\` 为 2。修改完成后向用户说明改了哪个任务的 status。
`;
