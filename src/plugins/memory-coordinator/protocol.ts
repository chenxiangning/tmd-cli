/**
 * memory-coordinator 插件协议 —— 记忆池只读契约与上游常量。
 *
 * 数据归宿是 Magic Context(外部,MIT)的共享 SQLite;本插件只做只读消费
 * 与编排,不做任何直写(写入一律经官方管线:d 路 omp 会话代写,Phase 2)。
 * 协议留插件内(kernel 准入 = 跨插件契约;当前唯一消费方是本插件)。
 *
 * 上游实证(PoC 报告 docs/research/magic-context-poc-report.md):
 * - 库路径经 getMagicContextStorageResolution 解析,bootstrap 时回存 settings;
 * - memories.project_path 存项目身份(`git:<root-commit>` / `dir:<md5[0..12]>`),
 *   两者均为标准/可复刻算法,不与上游内部实现耦合。
 */

/** 上游 memories.category 值域(注入优先级序,源码 CATEGORY_PRIORITY)。 */
export const MEMORY_CATEGORIES = [
  "PROJECT_RULES",
  "ARCHITECTURE",
  "CONSTRAINTS",
  "CONFIG_VALUES",
  "NAMING",
  "USER_DIRECTIVES",
  "USER_PREFERENCES",
  "CONFIG_DEFAULTS",
  "ARCHITECTURE_DECISIONS",
  "ENVIRONMENT",
  "WORKFLOW_RULES",
  "KNOWN_ISSUES",
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const CATEGORY_CN: Record<MemoryCategory, string> = {
  PROJECT_RULES: "项目规则",
  ARCHITECTURE: "架构",
  CONSTRAINTS: "约束",
  CONFIG_VALUES: "配置值",
  NAMING: "命名",
  USER_DIRECTIVES: "用户指令",
  USER_PREFERENCES: "用户偏好",
  CONFIG_DEFAULTS: "配置默认",
  ARCHITECTURE_DECISIONS: "架构决策",
  ENVIRONMENT: "环境",
  WORKFLOW_RULES: "工作流",
  KNOWN_ISSUES: "已知问题",
};

/** category → 注入优先级(上游 MEMORY_CATEGORY_ORDER 同序,越小越先)。 */
export const CATEGORY_ORDER: Readonly<Record<string, number>> =
  Object.fromEntries(MEMORY_CATEGORIES.map((c, i) => [c, i]));

/** 一条项目记忆(上游 memories 行的只读投影)。 */
export interface MemoryItem {
  id: number;
  /** 上游 category 原值(PROJECT_RULES / CONSTRAINTS / …)。 */
  category: string;
  content: string;
  importance: number | null;
  /** 上游 status:active 为生效;archive 等为治理态(Phase 1 只读展示)。 */
  status: string;
  updatedAt: number;
  createdAt: number;
  /** 沉淀来源 harness(session_projects.harness;omp 写入同为 "pi",上游字段)。 */
  harness: string;
}

export interface MemoryPoolStatus {
  /** bootstrap 已完成且库可读。 */
  ready: boolean;
  count: number;
  /** 共享库绝对路径(bootstrap 回存;未就绪为 null)。 */
  dbPath: string | null;
}

export interface MemoryPool {
  /** 按项目身份取生效记忆(可选 FTS 关键词;按上游注入优先级+重要度排序)。 */
  recall(projectIdentity: string, query?: string, limit?: number): Promise<MemoryItem[]>;
  status(): Promise<MemoryPoolStatus>;
}

/** 胶囊豁免的引擎:Magic Context 原生注入已覆盖,防止双重注入。 */
export const NATIVE_INJECT_PROFILES: Record<string, true> = {
  omp: true,
  pi: true,
  opencode: true,
};

/**
 * 复刻上游 resolveProjectIdentity 的 git 分支:git 仓库身份 = 字典序最小
 * root commit(`git rev-list --max-parents=0 HEAD`)。非 git 目录的
 * directoryFallback(dir:+md5(path)[0..12])不在此实现——tmd-cli 工作区
 * 常态是 git 仓库;非 git 工作区胶囊显示「项目未纳入记忆池」。
 */
export function projectIdentityFromRootCommit(rootCommit: string): string {
  return `git:${rootCommit}`;
}
