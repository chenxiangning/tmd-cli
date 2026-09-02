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
  /** npm 包名(不带 @latest),用于查 registry 最新版本。 */
  npmPackage: string;
}

/** 展示顺序 = 数组顺序(按用户接触概率)。 */
export const ENGINE_METAS: readonly EngineMeta[] = [
  {
    id: "omp",
    displayName: "OMP CLI",
    binary: "omp",
    docsUrl: "https://github.com/oh-my-pi/pi-coding-agent",
    installHint: "npm install -g @oh-my-pi/pi-coding-agent",
    npmPackage: "@oh-my-pi/pi-coding-agent",
  },
  {
    id: "pi",
    displayName: "PI CLI",
    binary: "pi",
    docsUrl: "https://github.com/earendil-works/pi-coding-agent",
    installHint: "npm install -g @earendil-works/pi-coding-agent",
    npmPackage: "@earendil-works/pi-coding-agent",
  },
  {
    id: "codex",
    displayName: "Codex CLI",
    binary: "codex",
    docsUrl: "https://github.com/openai/codex",
    installHint: "npm install -g @openai/codex",
    npmPackage: "@openai/codex",
  },
  {
    id: "claude",
    displayName: "Claude Code CLI",
    binary: "claude",
    docsUrl: "https://code.claude.com/docs/en/cli-reference",
    installHint: "curl -fsSL https://claude.ai/install.sh | bash",
    npmPackage: "@anthropic-ai/claude-code",
  },
  {
    id: "grok",
    displayName: "Grok CLI",
    binary: "grok",
    docsUrl: "https://github.com/xai-org/grok-build",
    // 官方 install.sh 走 x.ai(Cloudflare 墙),npm 通道更稳。
    installHint: "npm install -g @xai-official/grok",
    npmPackage: "@xai-official/grok",
  },
  {
    id: "kimi",
    displayName: "Kimi CLI",
    binary: "kimi",
    docsUrl: "https://moonshotai.github.io/kimi-code/",
    installHint: "npm install -g @moonshot-ai/kimi-code",
    npmPackage: "@moonshot-ai/kimi-code",
  },
  {
    id: "qoder",
    displayName: "Qoder CLI",
    binary: "qodercli",
    docsUrl: "https://docs.qoder.com",
    installHint: "npm install -g @qoder-ai/qodercli",
    npmPackage: "@qoder-ai/qodercli",
  },
  {
    id: "qoder-cn",
    displayName: "Qoder CLI (CN)",
    binary: "qoderclicn",
    docsUrl: "https://docs.qoder.cn",
    installHint: "npm install -g @qodercn-ai/qoderclicn",
    npmPackage: "@qodercn-ai/qoderclicn",
  },
] as const;

export const ENGINE_META_BY_ID: Record<string, EngineMeta> = Object.fromEntries(
  ENGINE_METAS.map((m) => [m.id, m]),
);
