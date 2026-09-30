/**
 * 每日日志磁盘布局与 io 原语(插件私有;路径根 = ipc.configDir() → ~/.tmd-cli)。
 *
 * 布局(设计 spec:docs/superpowers/specs/2026-09-29-daily-journal-design.md):
 * - daily/article/YYYY-MM-DD.md   每日一篇 AI 汇总文章,由生成会话(真实 CLI agent)直写;
 * - daily/digest/YYYY-MM-DD.md    当日会话内容摘录(tmd 提取层直写,生成会话的事实来源);
 * - daily/notes/YYYY-MM.json      用户手写便签(tmd 独占写,与文章物理分档互不覆盖);
 * - daily/meta.json               配置 + 每日事件账本(beads/生成状态/任务史截尾);
 * - daily/assets/                 便签截图附件(便签只存文件名引用);
 * - daily/holidays.json           节假日全年缓存(联网成功后落,离线兜底周末底纹)。
 *
 * fsCreateDir 非递归:建嵌套目录逐级建、忽略「已存在」错(adapterDeploy 同款)。
 */
import { ipc } from "@kernel/ipc";
import { ensureParentDir } from "@kernel/fsDirs";

export interface DayNoteImage {
  /** assets/ 内文件名(内容不在 JSON 里,展示时经 fsReadBytesBase64 取)。 */
  file: string;
  /** 粘贴时剪贴板文件名(展示用)。 */
  name: string;
}

/** 一天便签(notes/YYYY-MM.json 的日条目)。 */
export interface DayNote {
  text: string;
  images: DayNoteImage[];
  updatedAt: number;
}

/** 月度便签档:`{ "DD": DayNote }`。 */
export type NotesMonthFile = Record<string, DayNote>;

/** 生长珠子(一次生成/增量/干涉 = 一颗;时间字符串 HH:MM 或 HH:MM:SS)。 */
export interface JournalBead {
  t: string;
  label: string;
}

/** 每日账本条目(meta.json days 值;缺 = 该日无事件)。 */
export interface DayMeta {
  beads: JournalBead[];
  /** 产出本文的生成会话(host 会话 id;会话收尾后仍留作只读深链入口)。 */
  sessionId?: string;
  engine?: string;
  /** 最近一次成功生成抓取会话清单的时刻(ms):行 modifiedAt ≤ 此值 = 内容已并入文章。
   *  取清单时刻而非落盘时刻,生成期间继续活动的会话保持待归纳,下次增量覆盖。 */
  summarizedAt?: number;
  /** 最近一次生成失败原因(成功即清)。 */
  lastError?: string;
  updatedAt: number;
}

/** 生成配置(meta.json config;弹层编辑)。 */
export interface JournalConfig {
  timerOn: boolean;
  /** "HH:MM"。 */
  timerTime: string;
  /** 增量策略:auto 跟随实时 | manual 手动确认 | timer 仅定时。 */
  incPolicy: "auto" | "manual" | "timer";
  /** 生成引擎 profile id。 */
  engine: string;
  /** 模型名(空 = 引擎默认)。 */
  model: string;
  holidaysOn: boolean;
}

export const DEFAULT_CONFIG: JournalConfig = {
  timerOn: true,
  timerTime: "08:00",
  incPolicy: "auto",
  engine: "omp",
  model: "",
  holidaysOn: true,
};

export interface MetaFile {
  config: JournalConfig;
  days: Record<string, DayMeta>;
  /** 任务史(截尾 50)。 */
  tasks: unknown[];
}

export const EMPTY_META: MetaFile = { config: DEFAULT_CONFIG, days: {}, tasks: [] };

export const pad2 = (n: number): string => String(n).padStart(2, "0");
export const dayKey = (y: number, m: number, d: number): string => `${y}-${pad2(m)}-${pad2(d)}`;

export interface DailyPaths {
  root: string;
  article: (y: number, m: number, d: number) => string;
  /** 当日会话内容摘录(生成会话的事实来源;每次生成前重写)。 */
  digest: (y: number, m: number, d: number) => string;
  notes: (y: number, m: number) => string;
  meta: string;
  assets: string;
  holidays: string;
}

/** 每日日志根目录下全路径(模块级缓存;configDir 每进程恒定)。 */
let pathsLoading: Promise<DailyPaths> | null = null;

export function dailyPaths(): Promise<DailyPaths> {
  /* 微任务包一层:config_dir 在无 Tauri 环境(桩/单测)同步 throw,直接挂在 ??=
     右值会变成同步抛出,把 `void ensureHolidays(...)` 一类火忘调用打成 unhandled。 */
  pathsLoading ??= Promise.resolve().then(() => ipc.configDir()).then((base) => {
    const root = `${base}/daily`;
    return {
      root,
      article: (y, m, d) => `${root}/article/${dayKey(y, m, d)}.md`,
      digest: (y, m, d) => `${root}/digest/${dayKey(y, m, d)}.md`,
      notes: (y, m) => `${root}/notes/${y}-${pad2(m)}.json`,
      meta: `${root}/meta.json`,
      assets: `${root}/assets`,
      holidays: `${root}/holidays.json`,
    };
  });
  return pathsLoading;
}

/** 读 JSON;文件不存在/损坏/不可读返回 fallback(数据文件宽容读)。 */
export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const text = await ipc.fsReadFile(path);
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** 读文本;不存在返回 null(文章存在性判定)。 */
export async function readText(path: string): Promise<string | null> {
  try {
    return await ipc.fsReadFile(path);
  } catch {
    return null;
  }
}

/** 原子性弱保证的落盘(先写后删竞态可接受:数据文件小,单进程唯一写者)。 */
export async function writeText(path: string, content: string): Promise<void> {
  await ensureParentDir(path);
  await ipc.fsWriteFile(path, content);
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  await writeText(path, JSON.stringify(data, null, 1));
}
