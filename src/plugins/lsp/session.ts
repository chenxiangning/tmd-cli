/**
 * LSP 会话管理 —— 按 <workspaceRoot>::<language> 键聚合连接 + 文档同步账本。
 *
 * 惰性:首个语义动作(手势/键位/命令)才 discover+spawn;失败不缓存
 * (下一次手势自然重试,与 spec 生命周期语义一致)。空闲 10 分钟自动
 * 优雅关停。语言知识零沾:发现链/初始化选项全部来自 lspRegistry 的插件配置。
 */

import {
  closeLspConnection,
  lspConnectionState,
  openLspConnection,
  type LspConnection,
} from "@kernel/lsp/lspClient";
import {
  configForPath,
  owningWorkspaceRoot,
  type LanguageServerConfig,
} from "@kernel/lsp/lspRegistry";
import { normalizePath } from "@kernel/pathUtils";

/** 空闲关停窗(spec:10 分钟无请求即收)。 */
const IDLE_SHUTDOWN_MS = 10 * 60 * 1000;

export function pathToUri(path: string): string {
  const np = normalizePath(path);
  return `file://${np.split("/").map(encodeURIComponent).join("/")}`;
}

export interface DocChangeEvent {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  rangeLength: number;
  text: string;
}

export interface LspDocSession {
  conn: LspConnection;
  config: LanguageServerConfig;
  workspaceRoot: string;
  /** 该 server 的根 uri(resolveRoot 已裁决,java 可能不是工作区根)。 */
  rootUri: string;
  languageIdFor(path: string): string;
  didOpen(path: string, text: string): void;
  didChange(path: string, text: string, events: readonly DocChangeEvent[]): void;
  didClose(path: string): void;
}

interface SessionBox {
  session: Promise<LspDocSession> | null;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
  /** 文档同步账本:path → 版本号(didOpen 后才有)。 */
  versions: Map<string, number>;
}

const sessions = new Map<string, SessionBox>();

function sessionKey(workspaceRoot: string, language: string): string {
  return `${normalizePath(workspaceRoot)}::${language}`;
}

function touchActivity(key: string) {
  const box = sessions.get(key);
  if (!box) return;
  clearTimeout(box.idleTimer);
  box.idleTimer = setTimeout(() => {
    void closeLspConnection(key);
    sessions.delete(key);
  }, IDLE_SHUTDOWN_MS);
}

/**
 * 取(或建)某文件的语言服务会话;null = 该文件无配置或无归属工作区
 *(不猜测兜底)。并发调用共享同一次 discover+initialize。
 */
export function getSessionForPath(path: string): Promise<LspDocSession> | null {
  const config = configForPath(path);
  const workspaceRoot = owningWorkspaceRoot(path);
  if (!config || !workspaceRoot) return null;

  const key = sessionKey(workspaceRoot, config.language);
  touchActivity(key);
  const box = sessions.get(key) ?? {
    session: null,
    idleTimer: undefined,
    versions: new Map<string, number>(),
  };
  sessions.set(key, box);
  if (box.session) {
    /* 进程退出/已关停(state=none):弃缓存重建,崩溃/idle 关停后手势自愈。 */
    if (lspConnectionState(key) !== "none") return box.session;
    box.session = null;
  }

  const np = normalizePath(path);
  const serverLanguage = config.language;
  const initializationOptions = config.initializationOptions;
  const resolveRoot = config.resolveRoot;
  const versions = box.versions;
  box.session = (async (): Promise<LspDocSession> => {
    const root = resolveRoot ? await resolveRoot(np, workspaceRoot) : workspaceRoot;
    const launch = await config.discover(workspaceRoot);
    if (!launch) throw new Error("语言服务不可用(发现链无命中)");
    const conn0 = await openLspConnection({
      key,
      rootUri: pathToUri(root),
      launch,
      cwd: workspaceRoot,
      initializationOptions,
    });
    /* request 包装:真实请求才续期(idle 关停语义 = 无请求;初版只在建连路径
       touch,缓存 promise 后活跃使用仍被误杀)。 */
    const conn: LspConnection = {
      ...conn0,
      request: (method, params, timeoutMs) => {
        touchActivity(key);
        return conn0.request(method, params, timeoutMs);
      },
    };

    const languageIdFor = (p: string): string => {
      const dot = p.lastIndexOf(".");
      const ext = dot < 0 ? "" : p.slice(dot).toLowerCase();
      return EXT_LANGUAGE_IDS[ext] ?? serverLanguage;
    };
    const didOpen = (p: string, text: string) => {
      touchActivity(key);
      const v = (versions.get(p) ?? 0) + 1;
      versions.set(p, v);
      conn.notify("textDocument/didOpen", {
        textDocument: { uri: pathToUri(p), languageId: languageIdFor(p), version: v, text },
      });
    };
    const didChange = (p: string, text: string, events: readonly DocChangeEvent[]) => {
      touchActivity(key);
      const v = (versions.get(p) ?? 0) + 1;
      versions.set(p, v);
      conn.notify("textDocument/didChange", {
        textDocument: { uri: pathToUri(p), version: v },
        contentChanges: events.length > 0 ? events : [{ text }],
      });
    };
    const didClose = (p: string) => {
      if (!versions.delete(p)) return;
      conn.notify("textDocument/didClose", { textDocument: { uri: pathToUri(p) } });
    };

    return {
      conn,
      config,
      workspaceRoot,
      rootUri: pathToUri(root),
      languageIdFor,
      didOpen,
      didChange,
      didClose,
    };
  })();

  const inFlight = box.session;
  inFlight.catch(() => {
    // discover/spawn/initialize 失败:清缓存,下次手势重试;不弹噪音。
    if (sessions.get(key)?.session === inFlight) sessions.delete(key);
  });
  return box.session;
}

/** server 连接状态(右键置灰/手势自愈用);null = 该文件无配置或无归属工作区。 */
export function sessionStateForPath(path: string): "none" | "opening" | "ready" | null {
  const config = configForPath(path);
  const workspaceRoot = owningWorkspaceRoot(path);
  if (!config || !workspaceRoot) return null;
  return lspConnectionState(sessionKey(workspaceRoot, config.language));
}

/** 扩展名 → LSP languageId(ts/js 同一 server,文档级区分)。 */
const EXT_LANGUAGE_IDS: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".java": "java",
};
