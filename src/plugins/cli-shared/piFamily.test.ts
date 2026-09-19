/**
 * piFamily 契约测试 —— omp/pi 家族会话适配器工厂(被测:piFamily.ts)。
 * 覆盖契约清单:
 * - listSessions:目录缺省回 []、uuid 命名过滤(未知 id 不进列表)、mtime 倒序、标题/创建时刻真实解析;
 * - readSessionStatus:目录缺省 null、家族声明 modelKeys/providerKeys 生效、缺省探测键 ["model"];
 * - readSessionFileIdentity:只认 pi 家族 "type":"session" 行、读失败回 null 不抛(家族判别边界);
 * - readSessionUserMessages:omp/pi 行型端到端(assistant/XML 包装跳过)、目录/文件缺位回 null 非空数组;
 * - isDiskSessionEmpty:出生文件判空、有用户消息标记非空、读失败不删(false);
 * - remoteSessions:未声明 remoteSessionsDirSh 时整个键缺席(CliProfile 可缺省语义);
 *   远程 list:tab 行解码(b64/中文)、坏行协议、exec 失败同空数据、mtime 倒序截前 50;
 *   远程 readStatus:b64 尾窗解析、空串/失败回 null;
 * - readPiFamilySessionEdits:水位线增量、文件未生成(懒 flush)回 []、目录缺位/读失败回 null。
 *
 * 手法:仅 mock @kernel/ipc(依赖链唯一 Tauri 触点),兄弟模块全走真实现;sessionStatus/diskSessions
 * 有模块级缓存(tailGate/headCache),beforeEach vi.resetModules + 动态 import 取全新模块图(terminalLinks 先例)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDiskSession, RemoteExec } from "@kernel/cli";
import type { PiFamilyStore } from "./piFamily";
/* 命名空间只作类型用:运行时实例必须经 beforeEach 的动态 import 重取(模块级缓存) */
import type * as PiFamilyModule from "./piFamily";
import { parseEditEventsFromText } from "./sessionEdits";

const mocks = vi.hoisted(() => ({
  fsCollectFiles: vi.fn(),
  fsReadHead: vi.fn(),
  fsReadTail: vi.fn(),
  fsReadTailChanged: vi.fn(),
}));

vi.mock("@kernel/ipc", () => ({
  ipc: {
    fsCollectFiles: mocks.fsCollectFiles,
    fsReadHead: mocks.fsReadHead,
    fsReadTail: mocks.fsReadTail,
    fsReadTailChanged: mocks.fsReadTailChanged,
  },
}));

let mod: typeof PiFamilyModule;

/* —— 内存文件桩:content 缺失 = 读 reject(ENOENT 语义) —— */
const DIR = "/home/x/.omp/project/sessions";
const content = new Map<string, string>();
const listings = new Map<string, { name: string; path: string; modifiedAt: number }[]>();

const uuid = (hex12: string) => `aaaaaaaa-0000-4000-8000-${hex12}`;
const fileName = (u: string) => `2026-09-19T04-00-00-000Z_${u}.jsonl`;
const filePath = (u: string) => `${DIR}/${fileName(u)}`;

const sessionLine = (id: string, cwd = "/w", ts = "2026-09-19T04:00:00.000Z") =>
  JSON.stringify({ type: "session", id, cwd, timestamp: ts });
const userLine = (id: string, text: string) =>
  JSON.stringify({ type: "message", id, message: { role: "user", content: [{ type: "text", text }] } });
const assistantLine = (model: string, provider?: string) =>
  JSON.stringify({ type: "message", message: { role: "assistant", model, ...(provider ? { provider } : {}) } });

const store = (over: Partial<PiFamilyStore> = {}): PiFamilyStore => ({
  sessionsDir: async () => DIR,
  ...over,
});

const execOk = (out: string) => vi.fn<RemoteExec>().mockResolvedValue(out);
const execFail = () => vi.fn<RemoteExec>().mockRejectedValue(new Error("ws down"));
const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
const onlyPath = (path: string) => ({ path }) as CliDiskSession;
/* 远程协议行名 = basename 已剥 .jsonl(printf '%s' "$(basename "$f" .jsonl)") */
const remoteName = (u: string) => fileName(u).replace(/\.jsonl$/, "");
const givenFile = (u: string, mtime: number, text: string) => {
  content.set(filePath(u), text);
  listings.set(DIR, [...(listings.get(DIR) ?? []), { name: fileName(u), path: filePath(u), modifiedAt: mtime }]);
};

beforeEach(async () => {
  vi.resetAllMocks();
  vi.resetModules();
  content.clear();
  listings.clear();
  mocks.fsCollectFiles.mockImplementation(async (dir: string) => listings.get(dir) ?? []);
  const read = async (path: string) => {
    const text = content.get(path);
    if (text === undefined) throw new Error("ENOENT");
    return text;
  };
  mocks.fsReadHead.mockImplementation(read);
  mocks.fsReadTail.mockImplementation(read);
  mocks.fsReadTailChanged.mockImplementation(async (path: string) => {
    const text = await read(path);
    return { changed: true, size: text.length, text };
  });
  // 动态 import 例外:tailGate/headCache 模块级单例缓存,须 resetModules 取全新模块图
  mod = await import("./piFamily");
});

describe("listSessions 本地扫描装配", () => {
  it("目录缺省(未安装/找不到家目录)回空数组而非报错", async () => {
    const sessions = mod.piFamilySessions(store({ sessionsDir: async () => null }));
    await expect(sessions.listSessions("/w")).resolves.toEqual([]);
  });

  it("扫描装配:id 取文件名 uuid 段、mtime 倒序、标题与创建时刻真实解析", async () => {
    const u1 = uuid("111111111111");
    const u2 = uuid("222222222222");
    givenFile(u1, 2000, [sessionLine(u1), userLine("m1", "帮我改标题")].join("\n"));
    givenFile(u2, 1000, JSON.stringify({ type: "custom", customType: "compact_boundary" }));
    const got = await mod.piFamilySessions(store()).listSessions("/w");
    expect(got.map((s) => s.id)).toEqual([u1, u2]);
    expect(got[0]).toMatchObject({
      modifiedAt: 2000,
      createdAt: Date.parse("2026-09-19T04:00:00.000Z"),
      title: "帮我改标题",
      path: filePath(u1),
    });
    expect(got[1].title).toBeUndefined();
  });

  it("非 uuid 命名(未知 id)跳过,不顶进会话列表", async () => {
    const u = uuid("333333333333");
    listings.set(DIR, [{ name: "notes.jsonl", path: `${DIR}/notes.jsonl`, modifiedAt: 9999 }]);
    givenFile(u, 1, sessionLine(u));
    const got = await mod.piFamilySessions(store()).listSessions("/w");
    expect(got.map((s) => s.id)).toEqual([u]);
  });
});

describe("readSessionStatus 状态装配", () => {
  it("目录缺省 → null(状态能力不可用)", async () => {
    const sessions = mod.piFamilySessions(store({ sessionsDir: async () => null }));
    await expect(sessions.readSessionStatus("/w", "sid")).resolves.toBeNull();
  });

  it("家族声明生效:modelKeys 别名键探测 + providerKeys 补供应商前缀", async () => {
    const u = uuid("444444444444");
    givenFile(u, 1, JSON.stringify({ type: "model_change", modelId: "glm-5", provider: "zai" }));
    const sessions = mod.piFamilySessions(store({ modelKeys: ["modelId"], providerKeys: ["provider"] }));
    await expect(sessions.readSessionStatus("/w", u)).resolves.toEqual({ model: "zai/glm-5" });
  });

  it("缺省探测键是 [\"model\"];assistant 帧的全名模型胜过更早 model_change", async () => {
    const u = uuid("555555555555");
    givenFile(u, 1, [JSON.stringify({ type: "model_change", model: "kimi-k2" }), assistantLine("zai/kimi-k2")].join("\n"));
    const sessions = mod.piFamilySessions(store());
    await expect(sessions.readSessionStatus("/w", u)).resolves.toEqual({ model: "zai/kimi-k2" });
  });
});

describe("readSessionFileIdentity 身份自证", () => {
  it("pi 家族头:解出 id/cwd/createdAt", async () => {
    const u = uuid("666666666666");
    content.set("/s/a.jsonl", sessionLine(u, "/repo", "2026-09-01T00:00:00.000Z"));
    const sessions = mod.piFamilySessions(store());
    await expect(sessions.readSessionFileIdentity("/s/a.jsonl")).resolves.toEqual({
      id: u,
      cwd: "/repo",
      createdAt: Date.parse("2026-09-01T00:00:00.000Z"),
    });
  });

  it("家族判别边界:claude 家族头(sessionId 字段)不认;读失败回 null 不抛", async () => {
    content.set("/s/claude.jsonl", JSON.stringify({ sessionId: "u1", cwd: "/repo", timestamp: "2026-09-01T00:00:00.000Z" }));
    const sessions = mod.piFamilySessions(store());
    await expect(sessions.readSessionFileIdentity("/s/claude.jsonl")).resolves.toBeNull();
    await expect(sessions.readSessionFileIdentity("/s/missing.jsonl")).resolves.toBeNull();
  });
});

describe("readSessionUserMessages 用户消息装配", () => {
  it("omp/pi 行型端到端:只收真实用户输入,XML 包装与 assistant 跳过", async () => {
    const u = uuid("777777777777");
    givenFile(u, 1, [
      JSON.stringify({ type: "custom", customType: "session" }),
      userLine("m1", "<command-name>/init</command-name>"),
      assistantLine("glm-5"),
      userLine("m2", "把按钮改成红色"),
    ].join("\n"));
    const sessions = mod.piFamilySessions(store());
    await expect(sessions.readSessionUserMessages("/w", u, true)).resolves.toEqual([
      { id: "m2", text: "把按钮改成红色" },
    ]);
  });

  it("目录缺省与文件定位失败都回 null(≠ 空数组:调用方不推进水位)", async () => {
    const sessions = mod.piFamilySessions(store({ sessionsDir: async () => null }));
    await expect(sessions.readSessionUserMessages("/w", "sid", false)).resolves.toBeNull();
    await expect(sessions.readSessionUserMessages("/w", "ghost", false)).resolves.toBeNull();
  });
});

describe("isDiskSessionEmpty 判空装配", () => {
  it("出生文件判空;有用户消息标记非空;读失败判不了不删(false)", async () => {
    content.set(`${DIR}/birth.jsonl`, JSON.stringify({ type: "custom", customType: "session" }));
    content.set(`${DIR}/talked.jsonl`, userLine("m1", "hi"));
    const sessions = mod.piFamilySessions(store());
    await expect(sessions.isDiskSessionEmpty(onlyPath(`${DIR}/birth.jsonl`))).resolves.toBe(true);
    await expect(sessions.isDiskSessionEmpty(onlyPath(`${DIR}/talked.jsonl`))).resolves.toBe(false);
    await expect(sessions.isDiskSessionEmpty(onlyPath(`${DIR}/gone.jsonl`))).resolves.toBe(false);
  });
});

describe("remoteSessions 缺省与远程目录枚举", () => {
  const remoteOf = (over: Partial<PiFamilyStore> = {}) =>
    mod.piFamilySessions(store({ remoteSessionsDirSh: () => 'd="$HOME/.omp/slug"', ...over })).remoteSessions!;

  it("未声明 remoteSessionsDirSh 时 remoteSessions 键整个缺席", () => {
    expect("remoteSessions" in mod.piFamilySessions(store())).toBe(false);
  });

  it("远程 list:tab 行解码(b64/中文)、身份与标题解析、秒→毫秒、slug 进执行脚本", async () => {
    const u = uuid("aaaa11111111");
    const head = [sessionLine(u, "/w", "2026-09-19T01:00:00.000Z"), userLine("m1", "远程会话标题")].join("\n");
    const exec = execOk(`${remoteName(u)}\t1700000000\t${b64(head)}`);
    const got = await remoteOf().list(exec, "/w");
    expect(got).toEqual([{
      id: u,
      modifiedAt: 1700000000000,
      path: `remote:${fileName(u)}`,
      title: "远程会话标题",
      createdAt: Date.parse("2026-09-19T01:00:00.000Z"),
    }]);
    expect(exec.mock.calls[0][0]).toContain('d="$HOME/.omp/slug"');
  });

  it("坏行协议:非 uuid 结尾/缺 mtime 的行跳过;exec 失败同空数据回 []", async () => {
    const u = uuid("bbbb22222222");
    const rows = [
      `session-backup\t1700000001\t${b64(sessionLine(u))}`,
      `${remoteName(u)}\t\t${b64(sessionLine(u))}`,
      `${remoteName(u)}\t1700000002\t`,
    ];
    const got = await remoteOf().list(execOk(rows.join("\n")), "/w");
    expect(got).toEqual([{ id: u, modifiedAt: 1700000002000, path: `remote:${fileName(u)}` }]);
    await expect(remoteOf().list(execFail(), "/w")).resolves.toEqual([]);
  });

  it("按 mtime 倒序且截前 50 条限传输", async () => {
    const rows = Array.from({ length: 52 }, (_, i) => `${remoteName(uuid(String(51 - i).padStart(12, "0")))}\t${i + 1}\t`);
    const got = await remoteOf().list(execOk(rows.join("\n")), "/w");
    expect(got).toHaveLength(50);
    expect(got[0]).toMatchObject({ modifiedAt: 52000 });
    expect(got[49]).toMatchObject({ modifiedAt: 3000 });
  });
});

describe("remoteSessions.readStatus 远程状态回填", () => {
  const remoteOf = () =>
    mod.piFamilySessions(store({
      modelKeys: ["modelId"],
      providerKeys: ["provider"],
      remoteSessionsDirSh: () => "d=1",
    })).remoteSessions!;

  it("b64 尾窗走同一解析:modelKeys 别名 + provider 前缀生效", async () => {
    const tail = JSON.stringify({ type: "model_change", modelId: "glm-5", provider: "zai" });
    await expect(remoteOf().readStatus(execOk(b64(tail)), "/w", "sid")).resolves.toEqual({ model: "zai/glm-5" });
  });

  it("grep 无匹配(空串)与 exec 失败都回 null,不伪造状态", async () => {
    await expect(remoteOf().readStatus(execOk("  \n"), "/w", "sid")).resolves.toBeNull();
    await expect(remoteOf().readStatus(execFail(), "/w", "sid")).resolves.toBeNull();
  });
});

describe("readPiFamilySessionEdits 增量事件装配", () => {
  const parseEdits = (text: string, sinceTs: number) =>
    parseEditEventsFromText(
      text,
      sinceTs,
      "/w",
      (line) => line.startsWith("{"),
      (entry) =>
        typeof entry.path === "string" && typeof entry.ts === "number"
          ? [{ path: entry.path, ts: entry.ts }]
          : [],
    );

  it("水位线增量:只回 ts > sinceTs 的写入事件", async () => {
    const u = uuid("cccc33333333");
    givenFile(u, 1, [
      JSON.stringify({ type: "tool", path: "a.ts", ts: 1000 }),
      JSON.stringify({ type: "tool", path: "b.ts", ts: 2000 }),
    ].join("\n"));
    await expect(mod.readPiFamilySessionEdits(store(), parseEdits, "/w", u, 1500)).resolves.toEqual([
      { path: "b.ts", ts: 2000 },
    ]);
  });

  it("文件未生成(懒 flush)回 [] 而非 null;目录缺位与尾窗读失败回 null", async () => {
    await expect(mod.readPiFamilySessionEdits(store(), parseEdits, "/w", "ghost", 0)).resolves.toEqual([]);
    const none = store({ sessionsDir: async () => null });
    await expect(mod.readPiFamilySessionEdits(none, parseEdits, "/w", "sid", 0)).resolves.toBeNull();
    const u = uuid("dddd44444444");
    listings.set(DIR, [{ name: fileName(u), path: filePath(u), modifiedAt: 1 }]);
    await expect(mod.readPiFamilySessionEdits(store(), parseEdits, "/w", u, 0)).resolves.toBeNull();
  });
});
