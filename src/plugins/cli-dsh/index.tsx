import type { Plugin } from "@kernel/plugin";
import type { SpawnSpec } from "@kernel/ipc";
import type { QuotaSnapshot } from "@kernel/quota";
import { DshHostPanel } from "./hostPanel";
import { loadConnection } from "./dshHost";
import { listHostSessions, readHostSessionStatus, readHostDefaultStatus, readHostContextPressure, deleteHostSession } from "./dshRpc";
import { ensureAdapterDeployed } from "./adapterDeploy";

/**
 * DSH(DeepSeek Harness)插件 —— 第十个 CLI 引擎,对接口径移植自 codemoss:
 * - 会话 = PTY 跑适配器脚本(adapter/dsh-adapter.cjs):适配器是 DSH host-RPC
 *   的第二客户端(codemoss engine/dsh 同款线格式),把对话流转成 ANSI 文本
 *   进幕布、composer 文本经 stdin 转 session.prompt —— 会话/工作区/composer
 *   全走 tmd-cli 自家模型,不嵌 dsh 官方 Web UI。
 * - host 生命周期:适配器探针不通自拉起 `dsh web --no-open`(已在即 adopt);
 *   首页面板(hostPanel)仍可显式启停/打开 Web UI。
 * - 安装走加固 npm 通道(codemoss installer.rs 同款参数);npmPackage 仅查新版。
 *   前置 Node >=22.19 或 >=24,由 npm 通道自身依赖兜底。
 * - 会话读取走 host RPC 代读(dshRpc):DSH 会话体是 session.jsonl.zstd 压缩流,
 *   fs 文本原语读不了;删除同理无 host RPC,唯一通路 = 会话盘目录(dshRpc.deleteHostSession)。
 */

/** 分发渠道常量:二进制名 + npm 包。 */
export const DSH_VARIANT = {
  profileId: "dsh",
  command: "dsh",
  npmPackage: "@deepseek-ai/dsh",
} as const;

/** DeepSeek 鲸鱼标(@lobehub icons 单路径,viewBox 0 0 24 24;d 按 SVG 语法折行)。 */
const DSH_PATH = `M23.748 4.482c-.254-.124-.364.113-.512.234-.051.039-.094.09-.137.136-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.156-.708-.311-.955-.65
-.172-.241-.219-.51-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.093.172.187.129.323-.082.28-.18.552-.266.833-.055.179-.137.217-.329.14a5.526 5.526 0 01-1.736-1.18c-.857-.828-1.631-1.742-2.597-2.458a11.365 11.365 0 00-.689-.471c-.985-.957.13-1.743.388-1.836.27-.098.093-.432-.779-.428-.872.004-1.67.295-2.687.684a3.055 3.055 0 01-.465.137 9.597 9.597 0 00-2.883-.102c-1.885.21-3.39 1.102-4.497 2.623C.082 8.606-.231 10.684.152 12.85c.403 2.284 1.569 4.175 3.36 5.653 1.858 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.133-.284 4.994-1.86.47.234.962.327 1.78.397.63.059 1.236-.03 1.705-.128.735-.156.684-.837.419-.961-2.155-1.004-1.682-.595-2.113-.926 1.096-1.296 2.746-2.642 3.392-7.003.05-.347.007-.565 0-.845-.004-.17.035-.237.23-.256a4.173 4.173 0 001.545-.475c1.396-.763 1.96-2.015 2.093-3.517.02-.23-.004-.467-.247-.588zM11.581 18c-2.089-1.642-3.102-2.183-3.52-2.16-.392.024-.321.471-.235.763.09.288.207.486.371.739.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.167-1.361-.802-2.5-1.86-3.301-3.307-.774-1.393-1.224-2.887-1.298-4.482-.02-.386.093-.522.477-.592a4.696 4.696 0 011.529-.039c2.132.312 3.946 1.265 5.468 2.774.868.86 1.525 1.887 2.202 2.891.72 1.066 1.494 2.082 2.48 2.914.348.292.625.514.891.677-.802.09-2.14.11-3.054-.614zm1-6.44a.306.306 0 01.415-.287.302.302 0 01.2.288.306.306 0 01-.31.307.303.303 0 01-.304-.308zm3.11 1.596c-.2.081-.399.151-.59.16a1.245 1.245 0 01-.798-.254c-.274-.23-.47-.358-.552-.758a1.73 1.73 0 01.016-.588c.07-.327-.008-.537-.239-.727-.187-.156-.426-.199-.688-.199a.559.559 0 01-.254-.078c-.11-.054-.2-.19-.114-.358.028-.054.16-.186.192-.21.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.391.451.462.576.685.914.176.265.336.537.445.848.067.195-.019.354-.25.452z`;

export function DshGlyph({ size }: { size: number | string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      style={{ width: size, height: size, flexShrink: 0 }}
      aria-hidden
    >
      <path fill="currentColor" d={DSH_PATH} />
    </svg>
  );
}

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