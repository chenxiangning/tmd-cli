/**
 * DSH 插件装配 —— cliDshPlugin 定义(从 index.tsx 拆出,only-export-components;
 * index.tsx 只留品牌 glyph 组件)。对接口径见 index.tsx 头注。
 */

import type { Plugin } from "@kernel/plugin";
import type { SpawnSpec } from "@kernel/ipc";
import type { QuotaSnapshot } from "@kernel/quota";
import { DshGlyph } from "./index";
import { DshHostPanel } from "./hostPanel";
import { loadConnection } from "./dshConnection";
import { listHostSessions, readHostSessionStatus, readHostDefaultStatus, readHostContextPressure, deleteHostSession } from "./dshRpc";
import { ensureAdapterDeployed } from "./adapterDeploy";

/** 分发渠道常量:二进制名 + npm 包。 */
export const DSH_VARIANT = {
  profileId: "dsh",
  command: "dsh",
  npmPackage: "@deepseek-ai/dsh",
} as const;

export const cliDshPlugin: Plugin = {
  id: "cli-dsh",
  meta: {
    name: "DeepSeek Harness",
    abbr: "DS",
    desc: "DSH 引擎:装 CLI、起 web host、适配器会话内直接对话",
    icon: DshGlyph,
    iconColor: "#4D6BFE",
    category: "engine",
  },
  activate(ctx) {
    ctx.registerCliProfile({
      id: DSH_VARIANT.profileId,
      docsUrl: "https://www.npmjs.com/package/@deepseek-ai/dsh",
      npmPackage: DSH_VARIANT.npmPackage,
      name: DSH_VARIANT.command,
      renderIcon: (size) => <DshGlyph size={size} />,
      command: DSH_VARIANT.command,
      args: ["web"],
      triggers: [],
      /* spawnTransform:改写为 node 跑适配器脚本(PTY 会话 = 一条 DSH 对话,
         非 `dsh web` host):host/port 取连接配置,适配器经 adapterDeploy
         落盘到 configHome 后以绝对路径 spawn;host 未运行由适配器自拉起。
         多会话允许(每会话独立 workspace+session),单实例语义已废。 */
      spawnTransform: async (spec: SpawnSpec): Promise<SpawnSpec> => {
        const conn = loadConnection();
        const adapterPath = await ensureAdapterDeployed();
        /* resume 路径:args = resumeArgs 输出 ["--resume", id] → 翻成适配器 --session-id */
        const ri = spec.args.indexOf("--resume");
        const resumeId = ri >= 0 ? spec.args[ri + 1] : "";
        return {
          command: "node",
          args: [
            adapterPath,
            "--host", conn.host,
            "--port", String(conn.port),
            "--workspace-id", spec.cwd,
            "--workspace-path", spec.cwd,
            ...(resumeId ? ["--session-id", resumeId] : []),
            /* 0.1.2 起 host 全请求要 BrowserAuth cookie;面板拉起 host 后落盘,
             * 无 cookie 时适配器自拉起路径自行抓 token 换取。 */
            ...(conn.cookie ? ["--cookie", conn.cookie] : []),
            ...(conn.customBin ? ["--dsh-bin", conn.customBin] : []),
          ],
          cwd: spec.cwd,
          env: spec.env,
        };
      },
      /* 磁盘历史会话 = host session.list 按 cwd 过滤(zstd 会话盘 fs 读不了,RPC 代读);
         resume 经 --resume 标记进 spawnTransform → 适配器 --session-id。 */
      listSessions: (cwd) => listHostSessions(loadConnection(), cwd),
      deleteSession: (cliSessionId) => deleteHostSession(cliSessionId),
      resumeArgs: (cliSessionId) => ["--resume", cliSessionId],
      /* 工具栏「思考」位点击 = 写 /effort 进幕布开强度菜单。 */
      thinkingCommand: "/effort",
      readSessionStatus: (_cwd, cliSessionId) => readHostSessionStatus(loadConnection(), cliSessionId),
      readDefaultStatus: () => readHostDefaultStatus(loadConnection()),
      /* 额度位 = 会话上下文占用(session.list projections):
         balanceText 总量,windows 呈现 system/tools/messages 分解占比。 */
      fetchQuota: async (ctx): Promise<QuotaSnapshot> => {
        const base: QuotaSnapshot = {
          providerLabel: "DSH", title: "DSH 会话上下文", usedLabel: "已使用", windows: [],
        };
        if (!ctx.cliSessionId) return { ...base, error: "会话身份未绑定" };
        const cp = await readHostContextPressure(loadConnection(), ctx.cliSessionId);
        if (!cp) return { ...base, error: "host 未返回上下文投影" };
        const pct = Math.min(100, Math.round((cp.used / cp.window) * 100));
        const b = cp.breakdown;
        const win = (label: string, v?: number) =>
          v != null ? { label, displayPercent: Math.min(100, Math.round((v / cp.window) * 100)) } : null;
        const windows = [
          win("系统", b?.systemTokens), win("工具", b?.toolsTokens), win("消息", b?.messageTokens),
        ].filter((w): w is NonNullable<typeof w> => w !== null);
        return { ...base, windows, balanceText: `${pct}% · ${fmtK(cp.used)}/${fmtK(cp.window)} tok` };
      },
      /* 审批/提问卡片标记:适配器输出 [DSH 审批] / [DSH 提问] 时内核 askWatch 检测。 */
      askMarks: [/\[DSH 审批\]/, /\[DSH 提问\]/],
      scriptInstall: {
        unix: "npm i -g --maxsockets=1 --fetch-retries=5 --no-audit --no-fund @deepseek-ai/dsh@latest",
        windows:
          "npm i -g --maxsockets=1 --fetch-retries=5 --no-audit --no-fund @deepseek-ai/dsh@latest",
      },
    });
    /* 连接引导面板经 homePanels 注册表上卡(键 = profile id),不占 CliProfile 字段。 */
    ctx.registerHomePanel(DSH_VARIANT.profileId, DshHostPanel);
  },
};

/** token 数缩写(12.3k / 1.2M)。 */
function fmtK(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
}
