import { readJsonlSessionStatus } from "../cli-shared/sessionStatus";
import { ipc } from "@kernel/ipc";
import { parsePiFamilySessionHead } from "../cli-shared/sessionIdentity";
import {
  findJsonlSessionFile,
  ompPiUserMessageLine,
  readUserMessagesFromFile,
} from "../cli-shared/userMessages";
import { readOmpDefaultStatus } from "./configStatus";
import { registerOmpQuotaProvider } from "./quota";
import { ompSessionsDir, readOmpSessionEdits } from "./edits";
import { scanJsonlSessions } from "@kernel/diskSessions";
import type { CliDiskSession, CliSuggestion } from "@kernel/cli";
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
 * omp 磁盘会话存储与写入事件适配器在 ./edits.ts(审批线 events 归因第二信号源),
 * 目录 slug 规则随实现注释走,此处只消费。
 */

async function listOmpSessions(cwd: string): Promise<CliDiskSession[]> {
  const dir = await ompSessionsDir(cwd);
  if (!dir) return [];
  return scanJsonlSessions(dir);
}

async function readOmpSessionStatus(cwd: string, cliSessionId: string) {
  const dir = await ompSessionsDir(cwd);
  if (!dir) return null;
  return readJsonlSessionStatus(dir, cliSessionId, ["model"]);
}

/** 身份自证:头部 {"type":"session","id","cwd","timestamp"} 行(与 pi 同族,共享解析)。 */
async function readOmpSessionIdentity(path: string) {
  const head = await ipc.fsReadHead(path, 4 * 1024).catch(() => null);
  return head ? parsePiFamilySessionHead(head) : null;
}

async function readOmpUserMessages(cwd: string, cliSessionId: string, full: boolean) {
  const dir = await ompSessionsDir(cwd);
  if (!dir) return null;
  const path = await findJsonlSessionFile(dir, cliSessionId);
  if (!path) return null;
  return readUserMessagesFromFile(path, full, ompPiUserMessageLine);
}

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
    // 注册 omp quota provider(按当前模型前缀路由供应商,凭据走 Rust 只读 sqlite)。
    registerOmpQuotaProvider();
    ctx.registerCliProfile({
      id: "omp",
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
      resumeArgs: (sessionId) => ["--resume", sessionId],
      listSessions: listOmpSessions,
      readSessionStatus: readOmpSessionStatus,
      readSessionFileIdentity: readOmpSessionIdentity,
      readDefaultStatus: readOmpDefaultStatus,
      readSessionUserMessages: readOmpUserMessages,
      readSessionEdits: readOmpSessionEdits,
    });
  },
};
