/**
 * anim · tmd-anim 项目文件面(纯函数,无 ipc 依赖)。
 *
 * tmd-anim 的项目磁盘布局:~/.tmd-anim/projects/<id>.json,单文件即一项目,
 * 形状 = { version: 1, name, canvas?, scenes: Scene[] }(tmd-anim src/core/types.ts)。
 * 本插件只做最小解析(取 name 供展示),容错优先:解析失败显示「无效项目」,
 * 绝不崩;协议知识(~/.tmd-anim/protocol/*)归 tmd-anim 侧同步。
 */

/** tmd-anim 项目目录(绝对路径需先经 ipc.configHomeDir() 取 home)。 */
export function animProjectsDir(home: string): string {
  return `${home}/.tmd-anim/projects`;
}

/** 项目文件判定:目录列表过滤用,只认小写 .json(tmd-anim 自家命名约定)。 */
export function isAnimProjectFile(name: string): boolean {
  return !name.startsWith(".") && name.endsWith(".json");
}

/** 最小合法项目解析:只验 version/name/scenes 三个契约字段,其余忽略。 */
export function parseAnimProject(raw: string): { name: string } | null {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof doc !== "object" || doc === null) return null;
  const { version, name, scenes } = doc as Record<string, unknown>;
  if (version !== 1) return null;
  if (typeof name !== "string" || name.trim() === "") return null;
  if (!Array.isArray(scenes)) return null;
  return { name };
}

/** 最小合法项目桩(tmd-anim 打开即认;用户在应用里改名)。 */
export function stubProjectJson(): string {
  return JSON.stringify({ version: 1, name: "未命名动画", scenes: [] }, null, 2);
}

/** 桩文件名:p_anim_<base36 时间>_<短随机>;调用方供 now 与随机段(纯函数可测)。 */
export function stubProjectFileName(now: number, rand: string): string {
  return `p_anim_${now.toString(36)}_${rand}.json`;
}

/** 初始 prompt 正文(发给 CLI 的可编辑指令,中文工作台惯例不走 t(),先例 workbench/taskPrompt)。
 *  具体路径不在正文:引用文件在确认窗里以卡片预览,启动后挂 composer 卡片,发送时经 animRefsSendTransform 拼回 wire。 */
export function buildAnimSessionPrompt(): string {
  return [
    "你是 tmd-anim 动画修改助手。",
    "先阅读随附引用文件中的协议材料(schema 与示例),严格遵守其中约定。",
    "按用户后续要求修改随附的目标项目文件;只改目标项目文件,保持 schema 合法。",
    "每轮修改完成后:建议用户在 tmd-anim 应用里查看效果;",
    "如需自查,可在 tmd-anim 仓库目录内运行 `pnpm anim validate`(该命令只在 tmd-anim 仓库内可用,其他目录运行无意义)。",
  ].join("\n");
}

/** 确认时挂到会话 composer 的引用卡片(协议材料 + 目标项目,label = i18n 源键)。 */
export function animSessionRefs(home: string, projectPath: string): { label: string; path: string }[] {
  const protocol = `${home}/.tmd-anim/protocol`;
  return [
    { label: "协议 schema", path: `${protocol}/schema.md` },
    { label: "协议示例", path: `${protocol}/bpe-example.json` },
    { label: "目标项目", path: projectPath },
  ];
}
