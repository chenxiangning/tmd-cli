/**
 * 语言服务器注册表 —— 语言知识插件配置的 ctx 通道(lsp 域的注册面)。
 *
 * kernel 只存配置、按扩展名路由,不懂任何语言语义(哪个命令、npx 兜底、
 * java 找 pom 全是插件侧 discover 的知识)。同 language 后注册替换先注册。
 */

import { getActiveWorkspace, getWorkspaces } from "../workspace";
import { normalizePath } from "../pathUtils";

/** server 启动描述(discover 的产物;label 供状态提示)。 */
export interface LspServerLaunch {
  command: string;
  args: readonly string[];
  env?: Record<string, string>;
  label: string;
}

/** 语言服务器配置(插件 activate 时经 ctx.registerLanguageServer 登记)。 */
export interface LanguageServerConfig {
  /** LSP languageId,如 typescript / javascript / python / java。 */
  language: string;
  /** 命中扩展名(小写含点,如 [".ts", ".tsx"])。 */
  extensions: readonly string[];
  /** 发现链:工作区 → 启动描述;null = 不可用(置灰,不猜测兜底)。 */
  discover: (workspaceRoot: string) => Promise<LspServerLaunch | null>;
  /** 根目录覆写(java 向上找 pom/gradle);缺省 = 工作区根。 */
  resolveRoot?: (filePath: string, workspaceRoot: string) => Promise<string>;
  initializationOptions?: unknown;
}

let configs: readonly LanguageServerConfig[] = [];

/** 注册(activate 期调用);返回退订函数。 */
export function registerLanguageServer(config: LanguageServerConfig): () => void {
  const next = configs.filter((c) => c.language !== config.language);
  next.push(config);
  configs = next;
  return () => {
    configs = configs.filter(
      (c) => c.language !== config.language || c !== config,
    );
  };
}

export function languageServerConfigs(): readonly LanguageServerConfig[] {
  return configs;
}

/** 文件归属工作区(最长前缀;无归属回落活跃工作区)—— marks owningCwd 同款。 */
export function owningWorkspaceRoot(path: string): string | null {
  const np = normalizePath(path);
  let bestRoot = "";
  let best: string | null = null;
  for (const ws of getWorkspaces()) {
    const root = normalizePath(ws.root);
    if (np.startsWith(root + "/") && root.length > bestRoot.length) {
      bestRoot = root;
      best = root;
    }
  }
  return best ?? getActiveWorkspace()?.root ?? null;
}

/** 按文件路径找命中配置(扩展名匹配);返回 null = 该文件无语言服务。 */
export function configForPath(path: string): LanguageServerConfig | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = path.slice(dot).toLowerCase();
  return configs.find((c) => c.extensions.includes(ext)) ?? null;
}
