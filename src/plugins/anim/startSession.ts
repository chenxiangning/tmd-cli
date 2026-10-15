/**
 * anim · AI 会话启动管线(纯 DI,无 react/ipc 直接依赖,node 测试可跑;
 * 抽取先例 workbench genSettle / kernel menuNav)。
 *
 * 两步:
 * - prepareAiSessionTarget:点「AI 会话」,只决策不落盘(取消零副作用);
 * - startAnimAiSession:确认窗「启动会话」,桩先落盘再 spawn;spawn 失败清理
 *   本次落的桩(失败零残留,「取消零副作用」口径延伸到失败路径)。
 * 失败一律结构化上报原因,组件 t() 后 toast —— 不静默 return。
 */
import type { AiSessionTarget } from "./AiSessionDialog";
import {
  animProjectsDir,
  buildAnimSessionPrompt,
  parseAnimProject,
  stubProjectFileName,
  stubProjectJson,
} from "./animProjects";

/** 已解析的默认引擎(profile 缺失视同未选,组件侧归一为 null)。 */
export interface AnimEngine {
  profileId: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export type PrepareFailReason = "no-engine" | "no-home" | "invalid-project";
export type StartFailReason = "no-engine" | "no-home" | "start-failed";

export interface PrepareAiSessionInput {
  /** 主目录;null = configHomeDir 未归(首轮轮询前),此前点击给明确反馈。 */
  home: string | null;
  engine: AnimEngine | null;
  /** 行上项目路径;空态入口 = null(直接走建桩)。 */
  projectPath: string | null;
  /** 行上解析出的项目名(stub 回落「未命名动画」)。 */
  rowName: string | null;
  readFile: (path: string) => Promise<string>;
  now: () => number;
  /** 桩文件名随机段(非安全场景,组件供 Math.random 尾段)。 */
  rand: () => string;
}

export type PrepareAiSessionResult =
  | { ok: true; target: AiSessionTarget }
  | { ok: false; reason: PrepareFailReason };

export async function prepareAiSessionTarget(input: PrepareAiSessionInput): Promise<PrepareAiSessionResult> {
  const { home, engine, projectPath, rowName, readFile, now, rand } = input;
  if (!engine) return { ok: false, reason: "no-engine" };
  if (!home) return { ok: false, reason: "no-home" };
  let path = projectPath;
  let stub = false;
  let parsedName: string | null = null;
  if (path !== null) {
    const raw = await readFile(path).catch(() => null);
    if (raw === null) path = null; /* 列表后文件被删:回落建桩 */
    else {
      const parsed = parseAnimProject(raw);
      if (!parsed) return { ok: false, reason: "invalid-project" };
      parsedName = parsed.name; /* 行名瞬态缺失(rows 失明)时的回落 */
    }
  }
  if (path === null) {
    stub = true;
    path = `${animProjectsDir(home)}/${stubProjectFileName(now(), rand())}`;
  }
  const name = stub ? "未命名动画" : rowName ?? parsedName ?? "未命名动画";
  const protocol = `${home}/.tmd-anim/protocol`;
  return {
    ok: true,
    target: {
      name,
      path,
      stub,
      prompt: buildAnimSessionPrompt(),
      refs: [
        { label: "协议 schema", path: `${protocol}/schema.md`, kind: "doc" },
        { label: "协议示例", path: `${protocol}/bpe-example.json`, kind: "code" },
      ],
    },
  };
}

export interface StartAnimAiSessionInput {
  home: string | null;
  engine: AnimEngine | null;
  target: AiSessionTarget;
  deps: {
    ensureDir: (dir: string) => Promise<void>;
    writeFile: (path: string, content: string) => Promise<void>;
    removePath: (path: string) => Promise<void>;
    spawn: (engine: AnimEngine, spec: { cwd: string; title: string }) => Promise<{ id: string }>;
  };
}

export type StartAnimAiSessionResult =
  | { ok: true; sessionId: string }
  | { ok: false; reason: StartFailReason };

export async function startAnimAiSession(input: StartAnimAiSessionInput): Promise<StartAnimAiSessionResult> {
  const { home, engine, target, deps } = input;
  if (!engine) return { ok: false, reason: "no-engine" };
  if (!home) return { ok: false, reason: "no-home" };
  const dir = animProjectsDir(home);
  if (target.stub) {
    try {
      await deps.ensureDir(dir);
      await deps.writeFile(target.path, stubProjectJson());
    } catch (err) {
      console.warn("[anim] 桩落盘失败", err);
      return { ok: false, reason: "start-failed" }; /* 桩没写成,盘上无残留,无需清理 */
    }
  }
  try {
    const meta = await deps.spawn(engine, { cwd: dir, title: `tmd-anim:${target.name}` });
    return { ok: true, sessionId: meta.id };
  } catch (err) {
    console.warn("[anim] spawn 失败", err);
    if (target.stub) await deps.removePath(target.path).catch(() => {}); /* 只清本次落的桩,绝不碰用户文件 */
    return { ok: false, reason: "start-failed" };
  }
}
