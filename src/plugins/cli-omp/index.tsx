import { OmpGlyph } from "../cli-shared/engineGlyphs";
import { Package } from "@phosphor-icons/react";
import { piFamilySessions } from "../cli-shared/piFamily";
import { readOmpDefaultStatus } from "./configStatus";
import { ompConfigEntry } from "./configGui";
import { OmpProviderAuthPanel } from "./OmpProviderAuthPanel";
import { fetchOmpQuota } from "./quota";
import { ompSessionsDir, readOmpSessionEdits } from "./edits";
import { ompAcquireResume, startOmpPrewarmManager, stopOmpPrewarmManager } from "./prewarm";
import { listOmpSuggestions } from "./rpcCommands";
import { OmpExtensionMarket } from "./market";
import { PI_TUI_ASK_MARKS } from "../cli-shared/askMarks";
import { PI_TUI_ECHO_MARKS } from "../cli-shared/echoMarks";
import type { CliSuggestion } from "@kernel/cli";
import type { Plugin } from "@kernel/plugin";

/**
 * omp 磁盘会话四件套(扫描/状态/身份自证/用户消息)走 pi 族共享适配器;
 * 目录 slug 规则在 ./edits.ts(与 pi 分叉),写入事件同在 ./edits.ts。
 */
const ompSessions = piFamilySessions({
  sessionsDir: ompSessionsDir,
  /* 远程形态(WSL 发行版):slug 依赖远程 $HOME(ompSessionSlug 的 home 内分支),
     在 shell 里自算 —— cwd 恒为 posix,Windows 盘符分支不适用。工作区 root 落库
     是 ~ 形态(AddWslTab 惯例,wsl.exe --cd 会展开),先归一成绝对路径再分支,
     否则恒掉进 home 外分支找不到会话目录(远程历史/状态回填全空)。 */
  remoteSessionsDirSh: (cwd) => {
    const shq = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;
    return [
      "h=$HOME",
      `c=${shq(cwd.replace(/\\/g, "/"))}`,
      'case "$c" in "~"|"~"/*) c="$h${c#"~"}" ;; esac',
      'case "$c" in "$h") d="$h/.omp/agent/sessions" ;;',
      '"$h"/*) d="$h/.omp/agent/sessions/$(printf "%s" "${c#"$h"}" | tr / -)" ;;',
      '*) d="$h/.omp/agent/sessions/-$(printf "%s" "$c" | tr / -)-" ;;',
      "esac",
    ].join("\n");
  },
});

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
    /* 图形化配置面:贡献经 ctx 登记,渲染归 cli-config 插件。 */
    ctx.registerCliConfig({ ...ompConfigEntry, icon: (size) => <OmpGlyph size={size} />, providerPanel: () => <OmpProviderAuthPanel /> });
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
      /* 版本回退/收藏菜单:最新 10 个稳定版 + 用户收藏,钉版走本通道拼 @version。 */
      versionMenu: true,
      /* omp 运行时依赖 bun:welcome 引擎卡先探针 bun,缺失时引导先装 bun,
       * 就位前 omp 的安装/更新按钮不可点(契约见 kernel/cliProfile.ts requires)。 */
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
      /* 打开历史会话的预热接管(个性化能力;机制与降级护栏见 ./prewarm.ts):
       * 命中预热进程注入 /resume 热切换(0.24-1.2s),失配回落默认冷路径。 */
      acquireResume: ompAcquireResume,
      ...ompSessions,
      readDefaultStatus: readOmpDefaultStatus,
      readSessionEdits: readOmpSessionEdits,
      /* Ask 卡片标记(pi-tui 系共享字面量,见 cli-shared/askMarks.ts):
         会话列表「等待确认」标签 + 提示音的检测源。 */
      askMarks: PI_TUI_ASK_MARKS,
      /* 用户消息回显标记(pi-tui 系共享字面量,见 cli-shared/echoMarks.ts):
         webview 重载后 readopt 重锚的磁盘证据(契约见 kernel/cliProfile.ts echoMarks)。 */
      echoMarks: PI_TUI_ECHO_MARKS,
      /* win ConPTY 的 CPR 应答错位会被 pi-tui 当字符注入(架构 04 契约 7)。 */
      conptyCprMismatch: true,
      /* 轮次进行中的工作界面标记(实采 v18.1.19 / v18.3.1):⎋ 状态行(工作区
       * 动作行,零空闲误现)与 braille spinner 页脚行(spinner glyph + elapsed
       * 计时,如「⠧ 1m > ◉ …」)。elapsed 裸匹配「\d+[sm] >」在 v18.3.1 作废:
       * 空闲时钟页脚「⏺ 3m > ◉ …」同构命中,完工后的空闲屏每分钟喂一次假自证
       * (busy 钟永续,结算拖到分钟级;readopt 尾帧亦误判现势),故锚定 braille
       * glyph 族 —— v18.1/18.2 工作页脚「⠙ 9s · 模型」同族照旧命中。全屏 TUI
       * 以光标定位分行,不可用行首锚。命中即 CLI 自证在途,activityWatch 刷帧钟
       * 持轮(契约见 kernel/cliProfile.ts busyMarks)。 */
      busyMarks: [/⎋/u, /[⠀-⣿] ?\d+[sm]/u],
      /* v18.3.1 起不再声明 idleMarks:18.3 把 mc 行(「mc: … · idle」,idle 指
       * context 子系统状态)常驻画进工作屏页脚栈(两日志实采 ~1.1 万帧,仅
       * ~1% 不在工作页脚屏),π/⏺ 页脚亦跨态出没 —— 「工作期零共现」前提
       * 死亡,留着即中途假结算(徽标卡「空闲」,实证 2026-09-25)。代价:完工
       * 收口回落 busyHoldMs 自证钟尾窗(无闸 4d 的 ~2s 快速收口);18.3 空闲屏
       * 静默(分钟级跳格),旧「空闲页脚 ticker 加冕永挂」无复发面。机制保留
       * (kernel 闸 4d),待新版出现真正空闲独占字面量再实采挂回。 */
      /* v18.3.1 exec 期渲染冻结:长静默工具(cargo 编译等)整屏最长 ~60s 无任何
       * 帧(单轮实测 14 处,均为分钟跳格),默认 30s 自证窗必过期假结算且被 I2
       * 拦死。busyHoldMs 拉宽到 75s 盖住冻结;完工换装后徽标随之拖 ≤75s 翻空闲。 */
      busyHoldMs: 75_000,
      /* omp 是 oh-my-pi(pi fork),输入编辑器与 pi/kimi 同源 pi-tui:composer 整串
       * 正文+\r 同帧到达会命中"粘贴爆发"启发式,提交回车被改写成换行 —— win
       * 实测偶发"composer 发了但幕布没提交,须再手按回车"。声明后走 bracketed
       * paste 通路,与真实终端粘贴行为一致(契约见 kernel/cliProfile.ts)。 */
      bracketedPaste: true,
    });
    /* 预热接管管理器:后台常驻一个裸 omp 待命(有近期会话活动才预热,
     * 生命周期/降级护栏见 ./prewarm.ts);deactivate 强杀清场。 */
    startOmpPrewarmManager();
    return () => stopOmpPrewarmManager();
  },
};
