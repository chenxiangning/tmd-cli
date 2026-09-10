/**
 * 本地插件能力包装 —— 按 manifest.permissions 生成 tmd-sdk 命名空间的受限实例。
 *
 * IPC 面「方法 → 类别」的唯一事实源:IPC_METHOD_GRANTS(value null = 内核保留,
 * 永不对插件下发);settings 按 read/write 两组键位授权(常量与纯函数直通);
 * host 整面授权。类别常量在 plugin.ts(PLUGIN_PERMISSIONS),威胁模型边界见其注释。
 * 穷尽性由 pluginPermissions.grants.test.ts 机器把关:ipc 新增方法未登记即测试红。
 */
import * as hostModule from "./host";
import * as settingsModule from "./settings";
import { ipc } from "./ipc";
import type { PluginPermission } from "./plugin";

/* ── IPC 方法 → 类别 ────────────────────────────────────────────────
 * 分域原则:一个 Rust 命令域一个类别;强能力(进程/终端/网络)独立成类,
 * 便于 manifest 里一眼看懂与最小授权。 */

export const IPC_METHOD_GRANTS: Record<string, PluginPermission | null> = {
  /* 会话与 PTY:写终端字节、拉起/杀进程,强能力单独成类。 */
  sessionSpawn: "ipc.terminal",
  sessionList: "ipc.terminal",
  sessionWrite: "ipc.terminal",
  sessionResize: "ipc.terminal",
  sessionKill: "ipc.terminal",
  sessionLogSize: "ipc.terminal",
  sessionHistoryPage: "ipc.terminal",
  sessionLinkLog: "ipc.terminal",
  sessionDiskTail: "ipc.terminal",

  /* 进程执行与 CLI 管理(安装 = 跑脚本,与执行同级)。 */
  procCommunicate: "ipc.exec",
  cliProbe: "ipc.exec",
  cliInstallRun: "ipc.exec",

  /* 文件系统读。 */
  fsListDir: "ipc.fs.read",
  fsWalkFiles: "ipc.fs.read",
  fsReadFile: "ipc.fs.read",
  fsReadTail: "ipc.fs.read",
  fsReadHead: "ipc.fs.read",

  fsCollectFiles: "ipc.fs.read",
  readLocalImageDataUrl: "ipc.fs.read",
  readBinaryFileBase64: "ipc.fs.read",

  /* 文件系统写/管理。 */
  fsWriteTemp: "ipc.fs.write",
  fsWriteFile: "ipc.fs.write",
  fsCreateFile: "ipc.fs.write",
  fsCreateDir: "ipc.fs.write",
  fsRenameEntry: "ipc.fs.write",
  fsTrashEntry: "ipc.fs.write",
  fsRemovePath: "ipc.fs.write",
  fsRevealInFileManager: "ipc.fs.write",

  /* 工作区配置目录(不含全局 settings 盘文件 —— 那是内核保留)。 */
  configHomeDir: "ipc.config",
  configDefaultWorkspaceRoot: "ipc.config",
  configReadWorkspaces: "ipc.config",
  configWriteWorkspaces: "ipc.config",

  /* git 全域。 */
  gitStatus: "ipc.git",
  gitReposScan: "ipc.git",
  gitTotals: "ipc.git",
  gitAheadBehind: "ipc.git",
  gitDiffFilePatch: "ipc.git",
  gitStage: "ipc.git",
  gitUnstage: "ipc.git",
  gitDiscard: "ipc.git",
  gitCommit: "ipc.git",
  gitLog: "ipc.git",
  gitCommitFiles: "ipc.git",
  gitCommitFilePatch: "ipc.git",
  gitCommitMessage: "ipc.git",
  gitBranches: "ipc.git",
  gitCheckout: "ipc.git",
  gitCheckoutRemote: "ipc.git",
  gitCreateBranch: "ipc.git",
  gitDeleteBranch: "ipc.git",
  gitMergeBranch: "ipc.git",
  gitRebaseBranch: "ipc.git",
  gitRenameBranch: "ipc.git",
  gitBranchCompare: "ipc.git",
  gitBranchWorktreeFiles: "ipc.git",
  gitBranchWorktreePatch: "ipc.git",
  gitPullPush: "ipc.git",
  gitRemotes: "ipc.git",
  gitPushPreview: "ipc.git",
  gitRemoteRequest: "ipc.git",
  gitSmartCheckout: "ipc.git",
  gitSmartCheckoutUndo: "ipc.git",

  /* checkpoints 全域。 */
  checkpointAnchor: "ipc.checkpoints",
  checkpointRecordEdit: "ipc.checkpoints",
  checkpointSeal: "ipc.checkpoints",
  checkpointSealDead: "ipc.checkpoints",
  checkpointList: "ipc.checkpoints",
  checkpointBatchDiff: "ipc.checkpoints",
  checkpointApprove: "ipc.checkpoints",
  checkpointRestore: "ipc.checkpoints",
  checkpointApply: "ipc.checkpoints",
  checkpointUndoRevert: "ipc.checkpoints",
  checkpointPrune: "ipc.checkpoints",

  /* 网络(quota_fetch = 任意 URL 的通用 HTTP 代理)。 */
  quotaFetch: "ipc.net",

  /* sqlite 只读/写原语。 */
  sqliteQuery: "ipc.sql",
  sqliteExecute: "ipc.sql",

  /* SSH/SFTP/转发全域。 */
  sshSessionCreate: "ipc.ssh",
  sshSessionReconnect: "ipc.ssh",
  sshPromptAnswer: "ipc.ssh",
  sshPromptCancel: "ipc.ssh",
  sshLatency: "ipc.ssh",
  sshKnownHostsReset: "ipc.ssh",
  sftpList: "ipc.ssh",
  sftpReadText: "ipc.ssh",
  sftpWriteText: "ipc.ssh",
  sftpMkdir: "ipc.ssh",
  sftpRename: "ipc.ssh",
  sftpDelete: "ipc.ssh",
  sftpTransfer: "ipc.ssh",
  sftpTransferCancel: "ipc.ssh",
  sshForwardStart: "ipc.ssh",
  sshForwardStop: "ipc.ssh",
  sshForwardList: "ipc.ssh",
  sshForwardCheckPort: "ipc.ssh",

  /* 纯函数杂项(无 IO)。 */
  md5Hex: "ipc.util",

  /* 内核保留:全局 settings 盘文件 / 环境变量(凭据)/ 本地插件管理面(提权面)。 */
  configReadSettings: null,
  configWriteSettings: null,
  quotaEnvValue: null,
  pluginScan: null,
  pluginReadFile: null,
  pluginArchive: null,
  pluginRollback: null,
  pluginDelete: null,
};

/* settings 模块键位分组(穷尽性测试把关;settingsTypes/settingsAppearance 的
 * 类型再导出与常量/纯函数不经授权直通)。 */
export const SETTINGS_READ_KEYS = [
  "getSettingsState",
  "subscribeSettings",
  "useSettingsState",
] as const;
export const SETTINGS_WRITE_KEYS = [
  "updateSettings",
  "openSettingsPanel",
  "closeSettingsPanel",
] as const;
export const SETTINGS_INTERNAL_KEYS = ["ensureSettingsBooted", "settingsReady"] as const;

function deny(member: string, grant: PluginPermission | null): never {
  if (grant) {
    throw new Error(
      `插件缺少权限 "${grant}": ${member}(在 manifest.json permissions 声明并重新确认)`,
    );
  }
  throw new Error(`"${member}" 是内核保留能力,不对本地插件开放`);
}

/** 按授权集生成受限 ipc 门面:白名单成员直通,其余成员访问即抛明确错误。 */
export function wrapIpc(grants: ReadonlySet<string>): Record<string, unknown> {
  const allow = new Set<string>();
  for (const [method, perm] of Object.entries(IPC_METHOD_GRANTS)) {
    if (perm && grants.has(perm)) allow.add(method);
  }
  const target = ipc as unknown as Record<string, unknown>;
  return new Proxy(target, {
    get(_t, prop) {
      if (typeof prop !== "string") return Reflect.get(target, prop);
      if (allow.has(prop)) return target[prop];
      deny(prop, IPC_METHOD_GRANTS[prop] ?? null);
    },
  });
}

/** 按授权集生成受限 settings 门面:读/写两组键位各自授权,保留键剔除,其余直通。 */
export function wrapSettings(grants: ReadonlySet<string>): Record<string, unknown> {
  const mod = settingsModule as unknown as Record<string, unknown>;
  const read = grants.has("settings.read");
  const write = grants.has("settings.write");
  const internal = new Set<string>(SETTINGS_INTERNAL_KEYS as readonly string[]);
  const readKeys = new Set<string>(SETTINGS_READ_KEYS as readonly string[]);
  const writeKeys = new Set<string>(SETTINGS_WRITE_KEYS as readonly string[]);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(mod)) {
    if (internal.has(key)) continue;
    if (readKeys.has(key)) {
      if (read) out[key] = value;
      continue;
    }
    if (writeKeys.has(key)) {
      if (write) out[key] = value;
      continue;
    }
    out[key] = value;
  }
  return out;
}

/** host 门面整面授权:未授权时任何成员访问即抛。 */
export function wrapHost(grants: ReadonlySet<string>): Record<string, unknown> {
  if (grants.has("host")) return hostModule as unknown as Record<string, unknown>;
  return new Proxy({} as Record<string, unknown>, {
    get(_t, prop) {
      if (typeof prop !== "string") return undefined;
      deny(`host.${prop}`, "host");
    },
  });
}


/** settings 直通的纯函数(无能力语义;出现新函数时在此登记或归入 read/write/保留)。 */
export const SETTINGS_PURE_KEYS = [
  "resolveCliSessionQuota",
  "sanitizeTerminalFontSize",
  "sanitizeUiFontSize",
  "sanitizeTerminalFontFamily",
  "sanitizeUiZoom",
  "sanitizeSessionTabsMax",
  "sanitizeIconDecor",
] as const;
export const PERMISSION_LABELS: Record<PluginPermission, string> = {
  "ipc.terminal": "终端会话(读写 PTY、拉起/结束进程)",
  "ipc.exec": "执行本机进程",
  "ipc.fs.read": "读取本机文件",
  "ipc.fs.write": "写入/管理本机文件",
  "ipc.config": "读写工作区配置",
  "ipc.git": "Git 操作",
  "ipc.checkpoints": "检查点记账与回退",
  "ipc.net": "发起网络请求",
  "ipc.sql": "查询本地数据库",
  "ipc.ssh": "SSH/SFTP 远程操作",
  "ipc.util": "杂项工具函数",
  "settings.read": "读取客户端设置",
  "settings.write": "修改客户端设置",
  host: "宿主编排门面(会话创建/输出订阅)",
  events: "内核事件总线",
};
