/**
 * DiskIdentityWatch prompt 回声重验测试(绑后换对话缺口)。
 * 契约:CLI 在同一终端换磁盘会话(omp /new、进程重启、resume 换代)后,
 * 绑定值陈旧;promptSent 后短窗内按「提示词回声」补验 —— 未认领、id ≠ 绑定值、
 * mtime 不早于发送、末条用户消息 = 本条 prompt 的新兄弟文件 → 重绑;
 * claimed/文本不符/mtime 过老/多候选同文一律不绑(fail-open,宁漏勿串);
 * 健康路径(绑定文件自身是回声)零扰动。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiskIdentityWatch } from "./identityWatch";
import type { CliDiskSession, CliProfile } from "./cli";

const CWD = "/ws/demo";

const disk = (id: string, modifiedAt: number): CliDiskSession => ({
  id,
  modifiedAt,
  path: `${CWD}/${id}.jsonl`,
});

function makeDeps(overrides: {
  bound?: boolean;
  claimed?: string[];
  profile?: CliProfile;
}) {
  const onBound = vi.fn();
  const onEchoProbe = vi.fn();
  const claimed = new Set(overrides.claimed ?? []);
  const ctx = {
    getCliProfile: (id: string) => (id === "omp" ? overrides.profile : undefined),
    sessionAlive: (id: string) => id === "s1",
    isBound: () => overrides.bound ?? false,
    boundId: () => (overrides.bound ? "bound-old" : undefined),
    sessionMeta: () => ({ profileId: "omp", cwd: CWD }),
    claimedIds: () => claimed,
    onBound,
    onEchoProbe,
  };
  return { ctx, onBound, onEchoProbe };
}

/** 带用户消息读取的 profile:候选 id → 末条用户消息文本。 */
function echoProfile(
  list: CliDiskSession[],
  lastMessages: Record<string, string | null>,
  opts: { withUserMessages?: boolean } = {},
): CliProfile {
  return {
    id: "omp",
    name: "omp",
    command: "omp",
    listSessions: vi.fn().mockResolvedValue(list),
    ...(opts.withUserMessages === false
      ? {}
      : {
          readSessionUserMessages: vi
            .fn()
            .mockImplementation((_cwd: string, id: string) =>
              Promise.resolve(
                lastMessages[id] === null || lastMessages[id] === undefined
                  ? null
                  : [{ id: `${id}-m1`, text: lastMessages[id] as string }],
              ),
            ),
        }),
  } as unknown as CliProfile;
}

const registry: DiskIdentityWatch[] = [];
afterEach(() => {
  for (const w of registry) w.remove("s1");
  registry.length = 0;
});

describe("DiskIdentityWatch.prompt 回声重验", () => {
  const SENT_AT = 10_000;
  const probe = (prompt: string) => ({ token: 1, prompt, sentAt: SENT_AT });
  const fresh = (id: string): CliDiskSession => disk(id, SENT_AT - 1_000);

  it("唯一回声命中 → 重绑新身份(旧链原地保留语义归后端)", async () => {
    const d = makeDeps({
      bound: true,
      claimed: ["bound-old"],
      profile: echoProfile([fresh("new-id")], { "new-id": "pty 幕布功能调优方向" }),
    });
    const w = new DiskIdentityWatch(d.ctx);
    registry.push(w);
    await expect(w.probeEchoOnce("s1", probe("pty 幕布功能调优方向"))).resolves.toBe(true);
    expect(d.onBound).toHaveBeenCalledWith("s1", "new-id");
  });

  it("候选被其他会话认领 → 不绑;末条文本不符 → 不绑", async () => {
    const d = makeDeps({
      bound: true,
      claimed: ["bound-old", "claimed-id"],
      profile: echoProfile([fresh("claimed-id"), fresh("other-id")], {
        "claimed-id": "pty 幕布功能调优方向",
        "other-id": "别的对话",
      }),
    });
    const w = new DiskIdentityWatch(d.ctx);
    registry.push(w);
    await expect(w.probeEchoOnce("s1", probe("pty 幕布功能调优方向"))).resolves.toBe(false);
    expect(d.onBound).not.toHaveBeenCalled();
  });

  it("mtime 早于发送时刻(时钟余量外)→ 不绑", async () => {
    const stale = disk("stale-id", SENT_AT - 6_000);
    const d = makeDeps({
      bound: true,
      claimed: ["bound-old"],
      profile: echoProfile([stale], { "stale-id": "pty 幕布功能调优方向" }),
    });
    const w = new DiskIdentityWatch(d.ctx);
    registry.push(w);
    await expect(w.probeEchoOnce("s1", probe("pty 幕布功能调优方向"))).resolves.toBe(false);
    expect(d.onBound).not.toHaveBeenCalled();
  });

  it("两候选同文 → 归属不可判,放弃重绑(宁漏勿串)", async () => {
    const d = makeDeps({
      bound: true,
      claimed: ["bound-old"],
      profile: echoProfile([fresh("a"), fresh("b")], { a: "同一句话", b: "同一句话" }),
    });
    const w = new DiskIdentityWatch(d.ctx);
    registry.push(w);
    await expect(w.probeEchoOnce("s1", probe("同一句话"))).resolves.toBe(false);
    expect(d.onBound).not.toHaveBeenCalled();
  });

  it("绑定文件自身是唯一回声 → 维持原绑(健康路径零扰动)", async () => {
    const d = makeDeps({
      bound: true,
      claimed: ["bound-old"],
      profile: echoProfile([fresh("bound-old")], { "bound-old": "正常续聊" }),
    });
    const w = new DiskIdentityWatch(d.ctx);
    registry.push(w);
    await expect(w.probeEchoOnce("s1", probe("正常续聊"))).resolves.toBe(false);
    expect(d.onBound).not.toHaveBeenCalled();
  });

  it("未绑定 / profile 缺用户消息读取面 → revalidate 不开窗", () => {
    const unbound = makeDeps({ profile: echoProfile([], {}) });
    const w1 = new DiskIdentityWatch(unbound.ctx);
    registry.push(w1);
    w1.revalidate("s1", "x");
    expect(unbound.onEchoProbe).not.toHaveBeenCalled();

    const noReader = makeDeps({
      bound: true,
      claimed: ["bound-old"],
      profile: echoProfile([], {}, { withUserMessages: false }),
    });
    const w2 = new DiskIdentityWatch(noReader.ctx);
    registry.push(w2);
    w2.revalidate("s1", "x");
    expect(noReader.onEchoProbe).not.toHaveBeenCalled();
  });

  it("探测窗开合边沿:revalidate 开窗,remove 收束", () => {
    const d = makeDeps({ bound: true, claimed: ["bound-old"], profile: echoProfile([], {}) });
    const w = new DiskIdentityWatch(d.ctx);
    registry.push(w);
    w.revalidate("s1", "x");
    expect(d.onEchoProbe).toHaveBeenCalledWith("s1", true);
    w.remove("s1");
    expect(d.onEchoProbe).toHaveBeenCalledWith("s1", false);
  });

  it("token 交接:旧循环不得收新窗,陈旧证据不得绑(探测 await 期间重发 prompt)", async () => {
    vi.useFakeTimers();
    const { promise: list1, resolve: release1 } = Promise.withResolvers<CliDiskSession[]>();
    const { promise: list2, resolve: release2 } = Promise.withResolvers<CliDiskSession[]>();
    const lists = [list1, list2];
    const profile = {
      id: "omp", name: "omp", command: "omp",
      listSessions: vi.fn().mockImplementation(() => lists.shift()!),
      readSessionUserMessages: vi.fn().mockImplementation((_c: string, id: string) =>
        Promise.resolve([{ id: `${id}-m1`, text: id === "stale-hit" ? "第一句话" : "第二句话" }])),
    } as unknown as CliProfile;
    const d = makeDeps({ bound: true, claimed: ["bound-old"], profile });
    const w = new DiskIdentityWatch(d.ctx);
    registry.push(w);
    w.revalidate("s1", "第一句话"); /* token=1,旧循环睡第一拍 */
    await vi.advanceTimersByTimeAsync(30_000); /* 旧循环醒,卡在 listSessions */
    w.revalidate("s1", "第二句话"); /* token=2,新窗开(不重发开窗边沿) */
    release1([disk("stale-hit", Date.now())]); /* 旧证据此刻唯一命中 */
    await vi.advanceTimersByTimeAsync(0);
    expect(d.onBound).not.toHaveBeenCalled(); /* 陈旧证据不绑,绑定权归新循环 */
    expect(d.onEchoProbe.mock.calls).toEqual([["s1", true]]); /* 新窗未被旧循环收束 */
    await vi.advanceTimersByTimeAsync(30_000); /* 新循环醒,卡 listSessions */
    release2([disk("new-hit", Date.now())]);
    await vi.advanceTimersByTimeAsync(0);
    expect(d.onBound).toHaveBeenCalledWith("s1", "new-hit"); /* 新证据正常重绑 */
    expect(d.onEchoProbe.mock.calls).toEqual([["s1", true], ["s1", false]]); /* 新窗正常收束 */
  });

  it("回声比对折叠空白:prompt 带 \\r\\n 与 jsonl 存 \\n 同命中", async () => {
    const d = makeDeps({
      bound: true,
      claimed: ["bound-old"],
      profile: echoProfile([fresh("nl-id")], { "nl-id": "第一行\n第二行" }),
    });
    const w = new DiskIdentityWatch(d.ctx);
    registry.push(w);
    await expect(w.probeEchoOnce("s1", probe("第一行\r\n第二行"))).resolves.toBe(true);
    expect(d.onBound).toHaveBeenCalledWith("s1", "nl-id");
  });
});
