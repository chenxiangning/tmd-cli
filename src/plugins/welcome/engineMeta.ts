/**
 * 欢迎页引擎元数据 —— 每条对应一个已注册的 CLI profile。
 *
 * 静态表,不动态构造。新增 CLI 插件时两步都要做:
 *   1. plugins/index.ts 注册 plugin 的 CliProfile;
 *   2. 本表追加 EngineMeta(id = profile.id, binary = profile.command)。
 *
 * 设计决策:
 * - 只放"显示 + 安装"的元数据;触发符/resume 等逻辑归 CliProfile。
 * - docsUrl 缺失 = 不显示"官方文档"链接,而不是给个占位。
 */

export interface EngineMeta {
  /** CliProfile.id(omp / pi / codex / claude ...)。 */
  id: string;
  /** UI 展示名。 */
  displayName: string;
  /** 探针的 binary 名(PATH 中查找用)。 */
  binary: string;
  /** 官方文档 URL。undefined = 不显示。 */
  docsUrl?: string;
  /** 安装方式说明(按钮旁的提示文本)。 */
  installHint: string;
}

/** 展示顺序 = 数组顺序(按用户接触概率)。 */
export const ENGINE_METAS: readonly EngineMeta[] = [
  {
    id: "omp",
    displayName: "OMP CLI",
    binary: "omp",
    docsUrl: "https://github.com/oh-my-pi/pi-coding-agent",
    installHint: "npm install -g @oh-my-pi/pi-coding-agent",
  },
  {
    id: "pi",
    displayName: "PI CLI",
    binary: "pi",
    docsUrl: "https://github.com/earendil-works/pi-coding-agent",
    installHint: "npm install -g @earendil-works/pi-coding-agent",
  },
  {
    id: "codex",
    displayName: "Codex CLI",
    binary: "codex",
    docsUrl: "https://github.com/openai/codex",
    installHint: "npm install -g @openai/codex",
  },
  {
    id: "claude",
    displayName: "Claude Code CLI",
    binary: "claude",
    docsUrl: "https://code.claude.com/docs/en/cli-reference",
    installHint: "curl -fsSL https://claude.ai/install.sh | bash",
  },
] as const;

export const ENGINE_META_BY_ID: Record<string, EngineMeta> = Object.fromEntries(
  ENGINE_METAS.map((m) => [m.id, m]),
);
