/**
 * 工作台 · 领域类型与磁盘归一化。
 * 项目资料 = docs[](markdown 文档/附件/图片;内容落 docs 目录文件,index 只存
 * 元数据,防索引顶 496KB 读闸);任务 = 本体信息(描述/附件)+ 会话 link
 * (host/disk 两种引用,不侵入会话体系)。旧 Project.prd 字段已移除,由
 * store.loadWorkbench 读旧数据时迁移为首篇文档。
 */

export type ProjectStatus = "进行中" | "待启动" | "阻塞" | "暂停" | "已完成";
/** 仅 isProjectStatus 内部消费;无外部引用面,不导出。 */
const PROJECT_STATUSES: readonly ProjectStatus[] = ["进行中", "待启动", "阻塞", "暂停", "已完成"];

export type TaskStatus = "todo" | "doing" | "review" | "done" | "cancelled";
export const TASK_STATUSES: readonly TaskStatus[] = ["todo", "doing", "review", "done", "cancelled"];
/** 看板列(已取消不占列:看板隐藏该任务,设置入口 = 详情页状态下拉)。 */
export const BOARD_STATUSES: readonly TaskStatus[] = ["todo", "doing", "review", "done"];
/** 推进链(看板卡片/任务表推进钮共用):done/cancelled 无下一档。 */
export const NEXT_TASK_STATUS: Readonly<Partial<Record<TaskStatus, TaskStatus>>> = { todo: "doing", doing: "review", review: "done" };

export type UpdateKind = "note" | "progress" | "blocker" | "decision";
export const UPDATE_KINDS: readonly UpdateKind[] = ["note", "progress", "blocker", "decision"];

export type DocKind = "markdown" | "file" | "image";
export const DOC_KINDS: readonly DocKind[] = ["markdown", "file", "image"];

/** 项目文档元数据(index 形态);markdown/file/image 的内容都在 docs 目录文件。 */
export interface ProjectDoc {
  id: string;
  title: string;
  kind: DocKind;
  /** docs 目录内的磁盘文件名(markdown=.md;附件/图片保留扩展)。 */
  fileName: string;
  /** 字节数(markdown=内容长;附件=文件大小)。 */
  size: number;
  createdAt: string;
  updatedAt: string;
  /** 仅 markdown 文档:绑在本档上的附件/图片(上传入口在文档编辑器)。 */
  attachments: Attachment[];
  /** 仅内存:未落盘内容(旧 PRD 迁移/示例生成/编辑草稿),不进 index。 */
  content?: string;
}

/** 附件(图片/文件;任务与文档共用,同 docs 目录落盘策略)。 */
export interface Attachment {
  id: string;
  name: string;
  fileName: string;
  size: number;
  createdAt: string;
}

/** 任务↔会话 link(纯关联,不影响会话生命周期):
 *  host = 活会话宿主 id(聚焦 setActiveSession,可兜底磁盘恢复);
 *  disk = CLI 磁盘会话 id(openDiskSession 恢复)。 */
export interface TaskSessionLink {
  ref: string;
  kind: "host" | "disk";
  profileId: string;
  title: string;
  createdAt: string;
  /** CLI 磁盘身份(运行期绑定后回写;host 会话终结后凭它 resume,
   *  语义同 kind:"disk"。旧关联/绑定前即终结者缺省,打开回落提示)。 */
  cliSessionId?: string;
}

export interface ProjectUpdate {
  id: string;
  /** ISO 时间戳。 */
  at: string;
  kind: UpdateKind;
  text: string;
}

export interface ProjectTask {
  id: string;
  title: string;
  status: TaskStatus;
  owner?: string;
  /** 本地日历日 YYYY-MM-DD。 */
  startedOn?: string;
  dueDate?: string;
  /** 任务本体描述(markdown 纯文本)。 */
  description?: string;
  /** 同列表内排序(小在前)。 */
  order: number;
  createdAt: string;
  updatedAt: string;
  doneAt?: string;
  attachments: Attachment[];
  sessions: TaskSessionLink[];
  /** 执行记录(AI 按 AI-TASKS.md 约定回写;只追加不改删,时间正序展示)。 */
  updates: ProjectUpdate[];
}

export interface Project {
  id: string;
  name: string;
  module: string;
  status: ProjectStatus;
  owner: string;
  startedOn?: string;
  dueDate?: string;
  /** 0-100 整数。 */
  progress: number;
  link?: string;
  summary?: string;
  tags: string[];
  /** 可选绑定的工作区根(绝对路径);绑定后任务可在此 cwd 开会话、详情可见最近会话。 */
  cwd?: string;
  /** 软归档:退出概览/看板/聚焦全部统计与列表,不删实体,可恢复。 */
  archived?: boolean;
  /** 归档时刻(恢复时保留,仅作取证)。 */
  archivedAt?: string;
  docs: ProjectDoc[];
  createdAt: string;
  updatedAt: string;
  updates: ProjectUpdate[];
  tasks: ProjectTask[];
}

export function isProjectStatus(value: unknown): value is ProjectStatus {
  return PROJECT_STATUSES.includes(value as ProjectStatus);
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return TASK_STATUSES.includes(value as TaskStatus);
}

/** 未完成口径:done/cancelled 同为终结态(取消任务不计逾期、不进待跟进)。 */
export function isTaskOpen(task: Pick<ProjectTask, "status">): boolean {
  return task.status !== "done" && task.status !== "cancelled";
}

export function isUpdateKind(value: unknown): value is UpdateKind {
  return UPDATE_KINDS.includes(value as UpdateKind);
}

export function isDocKind(value: unknown): value is DocKind {
  return DOC_KINDS.includes(value as DocKind);
}

const str = (value: unknown): string | undefined => {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? undefined : text;
};

const nowIso = (): string => new Date().toISOString();

export const randId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** 磁盘 JSON → 实体(防御式归一化;任何字段不是预期形状都落到缺省,绝不抛错)。 */
export function normalizeProject(raw: unknown): Project {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const now = nowIso();
  const attachments = (value: unknown): Attachment[] =>
    Array.isArray(value)
      ? value.map((rawAtt) => {
          const att = (rawAtt && typeof rawAtt === "object" ? rawAtt : {}) as Record<string, unknown>;
          return {
            id: str(att.id) ?? randId("a"),
            name: str(att.name) ?? "附件",
            fileName: str(att.fileName) ?? `${str(att.id) ?? randId("a")}`,
            size: Number.isFinite(att.size) ? Number(att.size) : 0,
            createdAt: str(att.createdAt) ?? now,
          };
        })
      : [];
  const updatesOf = (value: unknown): ProjectUpdate[] => {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value
      .map((item) => {
        const update = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
        return {
          id: str(update.id) ?? randId("u"),
          at: str(update.at) ?? now,
          kind: isUpdateKind(update.kind) ? update.kind : ("note" as const),
          text: str(update.text) ?? "",
        };
      })
      .filter((item) => item.text !== "")
      /* id 是 React key:AI 手写出重 id(连写 u-1)时换发,渲染不炸。 */
      .map((item) => {
        if (seen.has(item.id)) return { ...item, id: randId("u") };
        seen.add(item.id);
        return item;
      });
  };
  const updates = updatesOf(source.updates);
  const docs = Array.isArray(source.docs)
    ? source.docs
        .map((item) => {
          const doc = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
          const createdAt = str(doc.createdAt) ?? now;
          return {
            id: str(doc.id) ?? randId("d"),
            title: str(doc.title) ?? "未命名文档",
            kind: isDocKind(doc.kind) ? doc.kind : "markdown",
            fileName: str(doc.fileName) ?? `${str(doc.id) ?? randId("d")}.md`,
            size: Number.isFinite(doc.size) ? Number(doc.size) : 0,
            createdAt,
            updatedAt: str(doc.updatedAt) ?? createdAt,
            attachments: attachments(doc.attachments),
          };
        })
    : [];
  const tasks = Array.isArray(source.tasks)
    ? source.tasks
        .map((item, index) => {
          const task = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
          const status = isTaskStatus(task.status) ? task.status : "todo";
          const createdAt = str(task.createdAt) ?? now;
          const taskAttachments = attachments(task.attachments);
          const sessions = Array.isArray(task.sessions)
            ? task.sessions.map((rawLink) => {
                const link = (rawLink && typeof rawLink === "object" ? rawLink : {}) as Record<string, unknown>;
                const kind: TaskSessionLink["kind"] = link.kind === "disk" ? "disk" : "host";
                return {
                  ref: str(link.ref) ?? "",
                  kind,
                  profileId: str(link.profileId) ?? "",
                  title: str(link.title) ?? "",
                  createdAt: str(link.createdAt) ?? now,
                  cliSessionId: str(link.cliSessionId),
                };
              }).filter((link) => link.ref !== "")
            : [];
          return {
            id: str(task.id) ?? randId("t"),
            title: str(task.title) ?? "",
            status,
            owner: str(task.owner),
            startedOn: str(task.startedOn),
            dueDate: str(task.dueDate),
            description: str(task.description),
            order: Number.isFinite(task.order) ? Number(task.order) : index,
            createdAt,
            updatedAt: str(task.updatedAt) ?? createdAt,
            doneAt: status === "done" ? str(task.doneAt) ?? str(task.updatedAt) ?? now : undefined,
            attachments: taskAttachments,
            sessions,
            updates: updatesOf(task.updates),
          };
        })
        .filter((task) => task.title !== "")
    : [];
  const createdAt = str(source.createdAt) ?? now;
  return {
    id: str(source.id) ?? randId("p"),
    name: str(source.name) ?? "未命名项目",
    module: str(source.module) ?? "其他项目",
    status: isProjectStatus(source.status) ? source.status : "进行中",
    owner: str(source.owner) ?? "我",
    startedOn: str(source.startedOn),
    dueDate: str(source.dueDate),
    progress: Number.isFinite(source.progress) ? Math.min(100, Math.max(0, Math.round(Number(source.progress)))) : 0,
    link: str(source.link),
    summary: str(source.summary),
    archived: source.archived === true,
    archivedAt: str(source.archivedAt),
    tags: Array.isArray(source.tags) ? source.tags.map((tag) => str(tag) ?? "").filter(Boolean) : [],
    cwd: str(source.cwd),
    docs,
    createdAt,
    updatedAt: str(source.updatedAt) ?? createdAt,
    updates,
    tasks,
  };
}

/** 新建项目的缺省实体(调用方补 name 等)。 */
export function blankProject(partial: Partial<Project> & { id: string; name: string }): Project {
  const now = nowIso();
  return normalizeProject({
    status: "进行中",
    owner: "我",
    module: "其他项目",
    progress: 0,
    docs: [],
    createdAt: now,
    updatedAt: now,
    updates: [],
    tasks: [],
    ...partial,
  });
}
