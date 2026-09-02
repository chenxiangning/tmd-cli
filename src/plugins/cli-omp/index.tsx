import { readJsonlSessionStatus } from "../cli-shared/sessionStatus";
import { readOmpDefaultStatus } from "./configStatus";
import { registerOmpQuotaProvider } from "./quota";
import { ipc } from "@kernel/ipc";
import { scanJsonlSessions } from "@kernel/diskSessions";
import type { CliDiskSession } from "@kernel/cli";
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
 * omp 磁盘会话存储(实证自 ~/.omp/agent/sessions/ 真实目录):
 * - 目录 = ~/.omp/agent/sessions/<slug>/<iso-ts>_<uuid>.jsonl
 * - slug 规则:
 *   - cwd 在 home 下: 去掉 home 前缀,"/" → "-"
 *     例 /Users/x/code/AI/github/tmd-cli → -code-AI-github-tmd-cli
 *   - cwd 在 home 外: 绝对路径 "/" → "-" 后两侧再包 "-"
 *     例 /private/tmp → --private-tmp--
 */
async function ompSessionsDir(cwd: string): Promise<string | null> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return null;
  /* 路径边界:/Users/foo2/x 不得误判在 home /Users/foo 之下。 */
  const inHome = cwd === home || cwd.startsWith(home + "/");
  const slug = inHome
    ? cwd.slice(home.length).replace(/\//g, "-")
    : `-${cwd.replace(/\//g, "-")}-`;
  return `${home}/.omp/agent/sessions/${slug}`;
}

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

/**
 * omp CLI 插件（CLI 能力矩阵调研结论）：
 * - `/` = 通用命令、`@` = 文件引用：原生支持，纯透传
 * - `$` = skill：omp 原生语法是 /skill:<name>，发送时翻译（方案 2）
 * - 会话恢复：--resume <uuid>；历史列表 = 扫 omp 自己的 jsonl 目录
 */
export const cliOmpPlugin: Plugin = {
  id: "cli-omp",
  meta: { name: "OMP", abbr: "OM", desc: "OMP CLI 引擎:会话扫描、配额、状态", category: "engine" },
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
        command: [
          { value: "help", description: "查看可用命令" },
          { value: "clear", description: "清屏" },
          { value: "model", description: "查看/切换模型" },
        ],
        skill: [
          { value: "think", description: "深度思考模式" },
          { value: "plan", description: "只读规划模式" },
          { value: "review", description: "代码评审" },
        ],
      },
      resumeArgs: (sessionId) => ["--resume", sessionId],
      listSessions: listOmpSessions,
      readSessionStatus: readOmpSessionStatus,
      readDefaultStatus: readOmpDefaultStatus,
    });
  },
};
