/**
 * 图标装饰(icon decor)域 —— 界面图标的独立颜色/呼吸闪烁设置类型与清洗。
 * 自 settingsAppearance.ts 拆出守 300 行铁则(域文件先例:sshSettings.ts)。
 * 变量名约定 `--icon-decor-<id>`;应用引擎 kernel/iconDecor.ts;消费规则
 * styles/icon-decor.css(逐点键)与 styles/icon-decor-families.css(2026-10-15 家族键)。
 */

/**
 * 可装饰图标 id 白名单,两段:
 *  - 逐点键(= 字形组合装饰位,ICON_SET 表覆盖面):单个挂点独立配色
 *    (rail/面板 tab、composer 输入轨、git/files 工具条等),消费经
 *    [data-action-id]/[data-panel-id]/home 样式表,见 styles/icon-decor.css。
 *  - 家族键(2026-10-15 全量纳管):一个键覆盖一个界面域的全部图标,挂点在容器根
 *    打 data-icon-decor="<键>",CSS 零特异性 :where() 消费,语义色槽以
 *    data-icon-keep 保防,见 styles/icon-decor-families.css。家族键只管颜色/闪烁,
 *    不参与字形组合(iconSet 表不认)。
 */
export const ICON_DECOR_POINT_IDS = [
  "newchat",
  "ssh-panel",
  "system-proxy",
  "panel-files",
  "panel-git",
  "panel-checkpoints",
  "panel-memory",
  "panel-memory-files",
  "panel-marks",
  "panel-approval-inbox",
  "panel-skill-hub",
  "panel-mcp-hub",
  "wsl-panel",
  "terminal",
  "intent-canvas",
  "session-board",
  "workbench",
  "remote-control",
  "worktree",
  "ws-files",
  "ws-manage",
  "ws-refresh",
  "market",
  "home",
  "fold-left",
  "fold-right",
  "stage-expand",
  "stage-collapse",
  "composer-drawer",
  "wake-agent",
  "wake-prompt",
  "ai-draw",
  "broadcast",
  "enhance",
  "wake-skill",
  "wake-mcp",
  "git-open",
  "git-open-location",
  "git-row-actions",
  "git-view",
  "git-layout",
  "git-remote",
  "git-worktree",
  "git-repo-ops",
  "git-diff-tools",
  "files-new-file",
  "files-new-folder",
  "files-refresh",
  "files-git-toggle",
] as const;

export const ICON_DECOR_FAMILY_IDS = [
  "menu",
  "dialog",
  "toast",
  "search",
  "window-controls",
  "session-tabs",
  "editor",
  "workspace-view",
  "command-drawer",
  "git-zone",
  "files-zone",
  "welcome",
  "settings",
  "market-page",
  "workbench-view",
  "board",
  "canvas",
  "session-view",
  "skill-hub",
  "mcp-hub",
  "checkpoints",
  "memory",
  "approval",
  "assets",
  "academy",
  "ssh",
  "wsl",
  "dsh",
  "cli-config",
  "net-proxy",
  "anim",
  "structured-session",
] as const;

export const ICON_DECOR_IDS = [...ICON_DECOR_POINT_IDS, ...ICON_DECOR_FAMILY_IDS] as const;
export type IconDecorId = (typeof ICON_DECOR_IDS)[number];
/** 字形组合装饰位 = 逐点键;iconSet 组合表(METAPHOR/LUCIDE)只认这一段。 */
export type IconSetGlyphId = (typeof ICON_DECOR_POINT_IDS)[number];

/** 单图标装饰:color 缺省 = 出厂配色;blink 缺省 = 出厂(仅 newchat 开)。 */
export interface IconDecorItem {
  color?: string;
  blink?: boolean;
}

/** 出厂默认:newchat 呼吸开(转正 2026-09-08 手加效果),其余全默认。 */
export const DEFAULT_ICON_DECOR: Record<IconDecorId, IconDecorItem> = {
  newchat: { blink: true },
  "ssh-panel": {},
  "system-proxy": {},
  "panel-files": {},
  "panel-git": {},
  "panel-checkpoints": {},
  "panel-memory": {},
  "panel-memory-files": {},
  "panel-marks": {},
  "panel-approval-inbox": {},
  "panel-skill-hub": {},
  "panel-mcp-hub": {},
  "wsl-panel": {},
  terminal: {},
  "intent-canvas": {},
  "session-board": {},
  workbench: {},
  "remote-control": {},
  worktree: {},
  "ws-files": {},
  "ws-manage": {},
  "ws-refresh": {},
  market: {},
  home: {},
  "fold-left": {},
  "fold-right": {},
  "stage-expand": {},
  "stage-collapse": {},
  "composer-drawer": {},
  "wake-agent": {},
  "wake-prompt": {},
  "ai-draw": {},
  broadcast: {},
  enhance: {},
  "wake-skill": {},
  "wake-mcp": {},
  "git-open": {},
  "git-open-location": {},
  "git-row-actions": {},
  "git-view": {},
  "git-layout": {},
  "git-remote": {},
  "git-worktree": {},
  "git-repo-ops": {},
  "git-diff-tools": {},
  "files-new-file": {},
  "files-new-folder": {},
  "files-refresh": {},
  "files-git-toggle": {},
  menu: {},
  dialog: {},
  toast: {},
  search: {},
  "window-controls": {},
  "session-tabs": {},
  editor: {},
  "workspace-view": {},
  "command-drawer": {},
  "git-zone": {},
  "files-zone": {},
  welcome: {},
  settings: {},
  "market-page": {},
  "workbench-view": {},
  board: {},
  canvas: {},
  "session-view": {},
  "skill-hub": {},
  "mcp-hub": {},
  checkpoints: {},
  memory: {},
  approval: {},
  assets: {},
  academy: {},
  ssh: {},
  wsl: {},
  dsh: {},
  "cli-config": {},
  "net-proxy": {},
  anim: {},
  "structured-session": {},
};

const ICON_DECOR_COLOR_RE = /^#[0-9a-f]{6}$/i;

/** 图标装饰清洗:键白名单外剔除,color 非 #rrggbb 丢弃,blink 非布尔回落出厂,空 item 剔除。 */
export function sanitizeIconDecor(raw: unknown): Record<IconDecorId, IconDecorItem> {
  const obj = typeof raw === "object" && raw !== null ? (raw as Record<string, Record<string, unknown>>) : null;
  const out = {} as Record<IconDecorId, IconDecorItem>;
  for (const id of ICON_DECOR_IDS) {
    const item = typeof obj?.[id] === "object" && obj[id] !== null ? obj[id] : {};
    const entry: IconDecorItem = {};
    if (typeof item.color === "string" && ICON_DECOR_COLOR_RE.test(item.color)) {
      entry.color = item.color.toLowerCase();
    }
    if (typeof item.blink === "boolean") {
      entry.blink = item.blink;
    } else if (DEFAULT_ICON_DECOR[id].blink === true) {
      entry.blink = true;
    }
    out[id] = entry;
  }

  return out;
}
