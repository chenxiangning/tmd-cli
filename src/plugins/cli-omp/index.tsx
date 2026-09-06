import { Package } from "@phosphor-icons/react";
import { piFamilySessions } from "../cli-shared/piFamily";
import { readOmpDefaultStatus } from "./configStatus";
import { fetchOmpQuota } from "./quota";
import { ompSessionsDir, readOmpSessionEdits } from "./edits";
import { listOmpSuggestions } from "./rpcCommands";
import { OmpExtensionMarket } from "./market";
import { PI_TUI_ASK_MARKS } from "../cli-shared/askMarks";
import type { CliSuggestion } from "@kernel/cli";
import type { Plugin } from "@kernel/plugin";

/**
 * OMP(oh-my-pi)品牌 π 字形:顶部横杠 + 左短竖 + 右长竖。
 * 粉紫→蓝渐变取自上游 hero 标志(codemoss EngineIcon 同源),
 * inline svg 不依赖 currentColor,深浅主题均清晰。
 */
const OMP_ICON_PATH =
  "M2.5 3h19v4h-19zM5.5 7h4.3v10H5.5zM13.2 7h4.3v14h-4.3z" as const;

function OmpGlyph({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      style={{ width: size, height: size, flexShrink: 0 }}
      aria-hidden
    >
      <defs>
        <linearGradient
          id="omp-engine-icon-gradient"
          x1="2.5"
          y1="3"
          x2="21.5"
          y2="21"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#E36BD4" />
          <stop offset="1" stopColor="#5B8BE8" />
        </linearGradient>
      </defs>
      <path fill="url(#omp-engine-icon-gradient)" d={OMP_ICON_PATH} />
    </svg>
  );
}

/**
 * omp 磁盘会话四件套(扫描/状态/身份自证/用户消息)走 pi 族共享适配器;
 * 目录 slug 规则在 ./edits.ts(与 pi 分叉),写入事件同在 ./edits.ts。
 */
const ompSessions = piFamilySessions({ sessionsDir: ompSessionsDir });

/**
 * omp 命令/技能候选(action 初判见 openspec/changes/composer-command-drawer)。
 * 技能注入后通常要跟任务文本 → 默认 insert;/model 为幕布内 picker → send。
 */
export const OMP_COMMAND_SUGGESTIONS: CliSuggestion[] = [
  { value: "help", description: "查看可用命令", action: "send", icon: "help" },
  { value: "clear", description: "清屏", action: "send", icon: "clear" },
  { value: "model", description: "查看/切换模型(幕布内 picker)", action: "send", icon: "model" },
];

export const OMP_SKILL_SUGGESTIONS: CliSuggestion[] = [
  { value: "think", description: "深度思考模式", icon: "think" },
  { value: "plan", description: "只读规划模式", icon: "plan" },
  { value: "review", description: "代码评审", icon: "review" },
];

/**
 * omp CLI 插件（CLI 能力矩阵调研结论）：
 * - `/` = 通用命令、`@` = 文件引用：原生支持，纯透传
 * - `$` = skill：omp 原生语法是 /skill:<name>，发送时翻译（方案 2）
 * - 会话恢复：--resume <uuid>；历史列表 = 扫 omp 自己的 jsonl 目录
 */
export const cliOmpPlugin: Plugin = {
  id: "cli-omp",
  meta: { name: "OMP", abbr: "OM", desc: "OMP CLI 引擎:会话扫描、配额、状态", icon: OmpGlyph, category: "engine" },
  activate(ctx) {
    /* 二级扩展市场:插排角标滑出面板(装卸 omp 自己的 npm 扩展)。 */
    ctx.registerMarketPanel({
      pluginId: "cli-omp",
      icon: Package,
      title: "omp 扩展市场",
      component: OmpExtensionMarket,
    });
    ctx.registerCliProfile({
      id: "omp",
      fetchQuota: fetchOmpQuota,
      docsUrl: "https://github.com/oh-my-pi/pi-coding-agent",
      npmPackage: "@oh-my-pi/pi-coding-agent",
      /* omp 官方推荐 bun 全局安装(docs/research/omp-cli-course/01-basics);
       * npmPackage 仅保留作 registry 最新版查询。 */
      commandInstall: {
        program: "bun",
        args: ["install", "-g", "@oh-my-pi/pi-coding-agent"],
      },
      /* omp 运行时依赖 bun:welcome 引擎卡先探针 bun,缺失时引导先装 bun,
       * 就位前 omp 的安装/更新按钮不可点(契约见 kernel/cli.ts requires)。 */
      requires: {
        binary: "bun",
        name: "Bun",
        docsUrl: "https://bun.sh",
        scriptInstall: {
          unix: "curl -fsSL https://bun.sh/install | bash",
          windows: "irm bun.sh/install.ps1|iex",
        },
      },
      name: "omp",
      renderIcon: (size) => <OmpGlyph size={size} />,
      command: "omp",
      args: [],
      triggers: [
        { char: "/", kind: "command" },
        { char: "@", kind: "file" },
        {
          char: "$",
          kind: "skill",
          translate: (token) => `/skill:${token.replace(/^\$/, "")}`,
        },
      ],
      suggestions: {
        command: OMP_COMMAND_SUGGESTIONS,
        skill: OMP_SKILL_SUGGESTIONS,
      },
      /* 命令/技能真相:RPC 副车 get_available_commands(含扩展注册命令与子命令),静态表兜底 */
      listSuggestions: listOmpSuggestions,
      resumeArgs: (sessionId) => ["--resume", sessionId],
      ...ompSessions,
      readDefaultStatus: readOmpDefaultStatus,
      readSessionEdits: readOmpSessionEdits,
      /* Ask 卡片标记(pi-tui 系共享字面量,见 cli-shared/askMarks.ts):
         会话列表「等待确认」标签 + 提示音的检测源。 */
      askMarks: PI_TUI_ASK_MARKS,
      /* omp 是 oh-my-pi(pi fork),输入编辑器与 pi/kimi 同源 pi-tui:composer 整串
       * 正文+\r 同帧到达会命中"粘贴爆发"启发式,提交回车被改写成换行 —— win
       * 实测偶发"composer 发了但幕布没提交,须再手按回车"。声明后走 bracketed
       * paste 通路,与真实终端粘贴行为一致(契约见 kernel/cli.ts)。 */
      bracketedPaste: true,
    });
  },
};
