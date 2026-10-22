/**
 * anim · AI 会话启动管线(纯 DI)单测 —— prepare(点「AI 会话」,零落盘)/
 * start(确认窗「启动会话」,桩先落盘再 spawn;spawn 失败清理本次落的桩)。
 * 交互挂载面走 1421 桩目检,此处钉决策与副作用序列(node 环境无 DOM)。
 */
import { describe, expect, it, vi } from "vitest";
import type { AiSessionTarget } from "./AiSessionDialog";
import { animProjectsDir, stubProjectJson } from "./animProjects";
import { prepareAiSessionTarget, startAnimAiSession, type AnimEngine } from "./startSession";

const HOME = "/home/u";
const DIR = animProjectsDir(HOME);
const ENGINE: AnimEngine = { profileId: "claude", command: "claude", args: ["--model", "x"], env: {} };
const validProject = JSON.stringify({ version: 1, name: "演示项目", scenes: [] });

const target = (over: Partial<AiSessionTarget> = {}): AiSessionTarget => ({
  name: "演示项目",
  path: `${DIR}/a.json`,
  stub: false,
  prompt: "p",
  refs: [],
  ...over,
});

/** 带调用序日志的 DI 桩(顺序断言用)。 */
function baseDeps(spawnImpl?: () => Promise<{ id: string }>) {
  const log: string[] = [];
  return {
    log,
    deps: {
      ensureDir: vi.fn(async (d: string) => { log.push(`ensureDir:${d}`); }),
      writeFile: vi.fn(async (p: string, c: string) => { log.push(`write:${p}:${c}`); }),
      removePath: vi.fn(async (p: string) => { log.push(`remove:${p}`); }),
      spawn: vi.fn(async () => {
        log.push("spawn");
        return spawnImpl ? await spawnImpl() : { id: "pty-1" };
      }),
    },
  };
}

describe("prepareAiSessionTarget", () => {
  it("无默认引擎:no-engine,不读文件", async () => {
    const readFile = vi.fn<(p: string) => Promise<string>>();
    await expect(
      prepareAiSessionTarget({ home: HOME, engine: null, projectPath: `${DIR}/a.json`, rowName: "a", readFile, now: () => 1, rand: () => "ab12" }),
    ).resolves.toEqual({ ok: false, reason: "no-engine" });
    expect(readFile).not.toHaveBeenCalled();
  });

  it("home 未就绪:no-home(回归锚:此前静默 return 无任何反馈)", async () => {
    const readFile = vi.fn<(p: string) => Promise<string>>();
    await expect(
      prepareAiSessionTarget({ home: null, engine: ENGINE, projectPath: null, rowName: null, readFile, now: () => 1, rand: () => "ab12" }),
    ).resolves.toEqual({ ok: false, reason: "no-home" });
    expect(readFile).not.toHaveBeenCalled();
  });

  it("行上文件读失败(被删/超限/IO):invalid-project 显性报错,不静默改道建桩", async () => {
    /* 大项目(内嵌配音 dataURL 超 512KB 预览闸)曾在此静默生成垃圾桩 ——
       读失败一律显性报错,桩只留给「未选项目」入口(projectPath=null)。 */
    const readFile = vi.fn<(p: string) => Promise<string>>().mockRejectedValue(new Error("gone"));
    await expect(
      prepareAiSessionTarget({ home: HOME, engine: ENGINE, projectPath: `${DIR}/gone.json`, rowName: "旧名", readFile, now: () => 42, rand: () => "zz9" }),
    ).resolves.toEqual({ ok: false, reason: "invalid-project" });
  });

  it("文件存在但坏:invalid-project,不静默改道建桩(防覆写用户手改内容)", async () => {
    const readFile = vi.fn<(p: string) => Promise<string>>().mockResolvedValue("{ broken");
    await expect(
      prepareAiSessionTarget({ home: HOME, engine: ENGINE, projectPath: `${DIR}/bad.json`, rowName: "bad", readFile, now: () => 1, rand: () => "ab12" }),
    ).resolves.toEqual({ ok: false, reason: "invalid-project" });
  });

  it("未选项目(projectPath=null):唯一建桩入口,名「未命名动画」,路径按桩命名约定", async () => {
    const readFile = vi.fn<(p: string) => Promise<string>>();
    const r = await prepareAiSessionTarget({ home: HOME, engine: ENGINE, projectPath: null, rowName: null, readFile, now: () => 42, rand: () => "zz9" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target.stub).toBe(true);
    expect(r.target.name).toBe("未命名动画");
    expect(r.target.path).toBe(`${DIR}/p_anim_${(42).toString(36)}_zz9.json`);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("正常路径:行名透传 + 协议五引用单源 + 指令正文,零落盘", async () => {
    const readFile = vi.fn<(p: string) => Promise<string>>().mockResolvedValue(validProject);
    const r = await prepareAiSessionTarget({ home: HOME, engine: ENGINE, projectPath: `${DIR}/a.json`, rowName: "演示项目", readFile, now: () => 1, rand: () => "ab12" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target).toMatchObject({ name: "演示项目", path: `${DIR}/a.json`, stub: false });
    expect(r.target.refs).toEqual([
      { label: "协议 schema", path: `${HOME}/.tmd-anim/protocol/schema.md`, kind: "doc" },
      { label: "叙事配方", path: `${HOME}/.tmd-anim/protocol/recipes.md`, kind: "doc" },
      { label: "小黑风格配方", path: `${HOME}/.tmd-anim/protocol/xiaohei-style.md`, kind: "doc" },
      { label: "小黑风格示例", path: `${HOME}/.tmd-anim/protocol/xiaohei-example.json`, kind: "code" },
      { label: "目标项目", path: `${DIR}/a.json`, kind: "code" },
    ]);
    expect(r.target.prompt).toContain("tmd-anim 动画修改助手");
  });

  it("windows: prompt 配音指引切 PowerShell 分支", async () => {
    const readFile = vi.fn<(p: string) => Promise<string>>().mockResolvedValue(validProject);
    const r = await prepareAiSessionTarget({ home: HOME, engine: ENGINE, projectPath: `${DIR}/a.json`, rowName: "演示项目", windows: true, readFile, now: () => 1, rand: () => "ab12" });
    expect(r.ok && r.target.prompt).toContain("System.Speech");
  });

  it("行名瞬态缺失(rows 失明)但文件合法:名回落文件解析名,不再误显「未命名动画」", async () => {
    const readFile = vi.fn<(p: string) => Promise<string>>().mockResolvedValue(validProject);
    const r = await prepareAiSessionTarget({ home: HOME, engine: ENGINE, projectPath: `${DIR}/a.json`, rowName: null, readFile, now: () => 1, rand: () => "ab12" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target.name).toBe("演示项目");
  });
});

describe("startAnimAiSession", () => {
  it("非桩:直接 spawn(cwd/title 正确),不写盘", async () => {
    const { deps, log } = baseDeps();
    const r = await startAnimAiSession({ home: HOME, engine: ENGINE, target: target(), deps });
    expect(r).toEqual({ ok: true, sessionId: "pty-1" });
    expect(deps.spawn).toHaveBeenCalledWith(ENGINE, { cwd: DIR, title: "tmd-anim:演示项目" });
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(log).toEqual(["spawn"]);
  });

  it("桩:先建目录写桩再 spawn(顺序钉死),桩内容 = 最小合法项目", async () => {
    const { deps, log } = baseDeps();
    const stubPath = `${DIR}/p_anim_x_y.json`;
    const r = await startAnimAiSession({ home: HOME, engine: ENGINE, target: target({ stub: true, path: stubPath }), deps });
    expect(r).toEqual({ ok: true, sessionId: "pty-1" });
    expect(log).toEqual([`ensureDir:${DIR}`, `write:${stubPath}:${stubProjectJson()}`, "spawn"]);
  });

  it("spawn 失败 + 桩:清理本次落的桩,报 start-failed(失败零残留)", async () => {
    const { deps, log } = baseDeps(() => Promise.reject(new Error("spawn boom")));
    const stubPath = `${DIR}/p_anim_x_y.json`;
    const r = await startAnimAiSession({ home: HOME, engine: ENGINE, target: target({ stub: true, path: stubPath }), deps });
    expect(r).toEqual({ ok: false, reason: "start-failed" });
    expect(log).toEqual([`ensureDir:${DIR}`, `write:${stubPath}:${stubProjectJson()}`, "spawn", `remove:${stubPath}`]);
  });

  it("清理自身失败:仍 resolved start-failed 不抛出(best-effort 语义)", async () => {
    const deps = {
      ensureDir: vi.fn(async () => {}),
      writeFile: vi.fn(async () => {}),
      removePath: vi.fn(async () => { throw new Error("remove boom"); }),
      spawn: vi.fn(async () => Promise.reject(new Error("spawn boom"))),
    };
    await expect(
      startAnimAiSession({ home: HOME, engine: ENGINE, target: target({ stub: true, path: `${DIR}/s.json` }), deps }),
    ).resolves.toEqual({ ok: false, reason: "start-failed" });
    expect(deps.removePath).toHaveBeenCalledTimes(1);
  });

  it("spawn 失败 + 非桩:不动用户文件,报 start-failed", async () => {
    const { deps, log } = baseDeps(() => Promise.reject(new Error("spawn boom")));
    const r = await startAnimAiSession({ home: HOME, engine: ENGINE, target: target(), deps });
    expect(r).toEqual({ ok: false, reason: "start-failed" });
    expect(deps.removePath).not.toHaveBeenCalled();
    expect(log).toEqual(["spawn"]);
  });

  it("写桩失败:start-failed,不 spawn 也不清理(盘上无桩)", async () => {
    const log: string[] = [];
    const deps = {
      ensureDir: vi.fn(async () => { log.push("ensureDir"); }),
      writeFile: vi.fn(async () => { log.push("write"); throw new Error("disk full"); }),
      removePath: vi.fn(async () => { log.push("remove"); }),
      spawn: vi.fn(async () => { log.push("spawn"); return { id: "pty-1" }; }),
    };
    const r = await startAnimAiSession({ home: HOME, engine: ENGINE, target: target({ stub: true, path: `${DIR}/s.json` }), deps });
    expect(r).toEqual({ ok: false, reason: "start-failed" });
    expect(log).toEqual(["ensureDir", "write"]);
  });

  it("无引擎 / 无 home:no-engine / no-home,零副作用", async () => {
    const a = baseDeps();
    await expect(startAnimAiSession({ home: HOME, engine: null, target: target({ stub: true }), deps: a.deps })).resolves.toEqual({ ok: false, reason: "no-engine" });
    const b = baseDeps();
    await expect(startAnimAiSession({ home: null, engine: ENGINE, target: target({ stub: true }), deps: b.deps })).resolves.toEqual({ ok: false, reason: "no-home" });
    expect(a.log).toEqual([]);
    expect(b.log).toEqual([]);
  });
});
