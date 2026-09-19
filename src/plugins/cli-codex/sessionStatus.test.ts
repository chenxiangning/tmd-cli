/**
 * codex 会话状态读取契约测试。
 * 覆盖:extractMeta —— 首行 session_meta 判别(后续行不算)、id 严格 hex36、
 * cwd 转义解码、createdAt 解析容错(非法时间戳不致命)、缺 id/cwd 返 null;
 * readCodexSessionStatus —— configHomeDir 失败、目录定位失败、meta 归属校验
 * (平台大小写语义:macos 不敏感 / linux 严格)、tail 模型优先于 head 兜底链
 * (model → headModel → headModelId)、思考强度键别名优先级
 * (reasoning_effort 胜于文件位置更晚的 effort)、仅思考强度无模型、
 * 双端均无信号 → null、读头失败不误杀归属未知会话。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
type SessionStatusMod = typeof import("./sessionStatus");

const mocks = vi.hoisted(() => ({
  configHomeDir: vi.fn(),
  fsCollectFiles: vi.fn(),
  fsReadHead: vi.fn(),
  fsReadTailChanged: vi.fn(),
  platformKind: "macos" as "macos" | "linux",
}));

vi.mock("@kernel/ipc", () => ({
  ipc: {
    configHomeDir: mocks.configHomeDir,
    fsCollectFiles: mocks.fsCollectFiles,
    fsReadHead: mocks.fsReadHead,
    fsReadTailChanged: mocks.fsReadTailChanged,
  },
}));

vi.mock("@kernel/platform", () => ({
  getPlatformKind: () => mocks.platformKind,
}));

/* 被测模块持有共享尺寸闸(cli-shared/sessionStatus 模块级 Map),
   静态导入无法取到全新闸实例,必须 resetModules + 动态 import 取全新实例防用例间串闸。 */
let mod: SessionStatusMod;

const SESSION_ID = "0f0e9d8c-5234-4567-9abc-def012345678";
const HOME = "/Users/x";
const DIR = `${HOME}/.codex/sessions`;
const FILE_PATH = `${DIR}/rollout-2026-09-03T10-00-00-${SESSION_ID}.jsonl`;

function metaLine(over: { id?: string; cwd?: string; ts?: string } = {}): string {
  return JSON.stringify({
    timestamp: over.ts ?? "2026-09-03T08:00:00.123Z",
    type: "session_meta",
    payload: { id: over.id ?? SESSION_ID, cwd: over.cwd ?? "/Users/x/ws" },
  });
}

function setup(head: string, tail: string, files?: Array<{ name: string; path: string }>) {
  mocks.configHomeDir.mockResolvedValue(HOME);
  mocks.fsCollectFiles.mockResolvedValue(
    files ?? [{ name: `rollout-${SESSION_ID}.jsonl`, path: FILE_PATH }],
  );
  mocks.fsReadHead.mockResolvedValue(head);
  mocks.fsReadTailChanged.mockResolvedValue({ changed: true, size: tail.length, text: tail });
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.platformKind = "macos";
  mod = await import("./sessionStatus");
});

describe("extractMeta 头部解析", () => {
  it("标准 meta 行解析出 id/cwd/createdAt", () => {
    expect(mod.extractMeta(metaLine())).toEqual({
      id: SESSION_ID,
      cwd: "/Users/x/ws",
      createdAt: Date.parse("2026-09-03T08:00:00.123Z"),
    });
  });

  it("cwd 带转义序列时解码为真实路径", () => {
    expect(mod.extractMeta(metaLine({ cwd: '/Users/x/"ws"' }))?.cwd).toBe('/Users/x/"ws"');
  });

  it("首行非 session_meta 即返 null,后续行不再看", () => {
    expect(mod.extractMeta(`{"type":"event_msg"}\n${metaLine()}`)).toBeNull();
  });

  it("id 非小写 hex36(大写字母)不匹配 → null", () => {
    expect(mod.extractMeta(metaLine({ id: "XXXXXXXX-1234-4567-89ab-cdef12345678" }))).toBeNull();
  });

  it("缺 cwd → null", () => {
    const line = `{"type":"session_meta","payload":{"id":"${SESSION_ID}"}}`;
    expect(mod.extractMeta(line)).toBeNull();
  });

  it("timestamp 非法时 createdAt 缺省,id/cwd 照常解析", () => {
    const meta = mod.extractMeta(metaLine({ ts: "not-a-date" }));
    expect(meta).toEqual({ id: SESSION_ID, cwd: "/Users/x/ws", createdAt: undefined });
  });
});

describe("readCodexSessionStatus", () => {
  it("configHomeDir 失败 → null,不做目录扫描", async () => {
    mocks.configHomeDir.mockRejectedValue(new Error("ipc down"));
    expect(await mod.readCodexSessionStatus("/Users/x/ws", SESSION_ID)).toBeNull();
    expect(mocks.fsCollectFiles).not.toHaveBeenCalled();
  });

  it("目录无同名文件 → null", async () => {
    setup(metaLine(), "{}", [{ name: "other.jsonl", path: `${DIR}/other.jsonl` }]);
    expect(await mod.readCodexSessionStatus("/Users/x/ws", SESSION_ID)).toBeNull();
  });

  it("meta.cwd 与请求 cwd 不匹配 → null(跨工作区防误读)", async () => {
    setup(metaLine({ cwd: "/Users/other/ws" }), '{"model":"gpt-5.1"}');
    expect(await mod.readCodexSessionStatus("/Users/x/ws", SESSION_ID)).toBeNull();
  });

  it("大小写不敏感平台(macos):cwd 大小写差异仍匹配", async () => {
    setup(metaLine({ cwd: "/users/x/ws" }), '{"model":"gpt-5.1"}');
    const status = await mod.readCodexSessionStatus("/Users/x/ws", SESSION_ID);
    expect(status?.model).toBe("gpt-5.1");
  });

  it("linux 平台:cwd 大小写差异判不匹配(严格语义)", async () => {
    mocks.platformKind = "linux";
    vi.resetModules();
    mod = await import("./sessionStatus");
    setup(metaLine({ cwd: "/users/x/ws" }), '{"model":"gpt-5.1"}');
    expect(await mod.readCodexSessionStatus("/Users/x/ws", SESSION_ID)).toBeNull();
  });

  it("tail 模型优先于 head 模型", async () => {
    const head = `${metaLine()}\n{"type":"turn_context","payload":{"model":"gpt-5-head"}}`;
    setup(head, '{"model":"gpt-5.1-tail"}');
    expect((await mod.readCodexSessionStatus("/Users/x/ws", SESSION_ID))?.model).toBe(
      "gpt-5.1-tail",
    );
  });

  it("tail 无 model 时按 head model → head modelId 顺序兜底", async () => {
    const withModel = `${metaLine()}\n{"model":"gpt-5-head"}`;
    setup(withModel, '{"type":"event_msg"}');
    expect((await mod.readCodexSessionStatus("/Users/x/ws", SESSION_ID))?.model).toBe(
      "gpt-5-head",
    );

    vi.clearAllMocks();
    const withModelId = `${metaLine()}\n{"modelId":"gpt-5-id"}`;
    setup(withModelId, '{"type":"event_msg"}');
    expect((await mod.readCodexSessionStatus("/Users/x/ws", SESSION_ID))?.model).toBe("gpt-5-id");
  });

  it("思考强度键别名按优先级:reasoning_effort 胜于文件位置更晚的 effort", async () => {
    setup(metaLine(), '{"reasoning_effort":"high"}\n{"effort":"low"}');
    const status = await mod.readCodexSessionStatus("/Users/x/ws", SESSION_ID);
    expect(status?.thinkingLevel).toBe("high");
  });

  it("model 键胜于更晚出现的 modelId(键优先级,非位置)", async () => {
    setup(metaLine(), '{"model":"m1"}\n{"modelId":"m2"}');
    expect((await mod.readCodexSessionStatus("/Users/x/ws", SESSION_ID))?.model).toBe("m1");
  });

  it("仅思考强度无模型 → 只返回 thinkingLevel", async () => {
    setup(metaLine(), '{"reasoning_effort":"medium"}');
    expect(await mod.readCodexSessionStatus("/Users/x/ws", SESSION_ID)).toEqual({
      model: undefined,
      thinkingLevel: "medium",
    });
  });

  it("tail 与 head 均无模型信号 → null", async () => {
    setup(metaLine(), '{"type":"event_msg","payload":{}}');
    expect(await mod.readCodexSessionStatus("/Users/x/ws", SESSION_ID)).toBeNull();
  });

  it("读头失败(归属未知)不误杀:tail 有模型仍返回", async () => {
    mocks.configHomeDir.mockResolvedValue(HOME);
    mocks.fsCollectFiles.mockResolvedValue([
      { name: `rollout-${SESSION_ID}.jsonl`, path: FILE_PATH },
    ]);
    mocks.fsReadHead.mockRejectedValue(new Error("io"));
    mocks.fsReadTailChanged.mockResolvedValue({
      changed: true,
      size: 20,
      text: '{"model":"gpt-5.1"}',
    });
    const status = await mod.readCodexSessionStatus("/Users/x/ws", SESSION_ID);
    expect(status?.model).toBe("gpt-5.1");
  });
});
