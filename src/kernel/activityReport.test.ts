/**
 * 活动板上报契约 —— hostWatches 活动守望(权威态)经 ActivityReporter 全量投影到
 * 注册表活动板(session_report_activity),手机 session_list 直读「运行中」区成员。
 * 快照取自真实 HostWatches(手写 ctx 桩,hostWatches.test.ts 同款);ipc 面本文件打桩。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ipc } from "./ipc";
import { HostWatches } from "./hostWatches";
import type { ActivitySnapshotEntry } from "./activityReport";
import type { CliProfile } from "./cli";
import { EventBus } from "./events";
import type { SessionMeta } from "./ipc";

/** 手写 ctx 桩(hostWatches.test.ts makeWatches 同款最小面)。 */
function makeWatches(profiles: CliProfile[] = []) {
  const sessions = new Map<string, SessionMeta>();
  const profileMap = new Map(profiles.map((p) => [p.id, p]));
  let activeId: string | null = null;
  const hw = new HostWatches({
    getCliProfile: (id) => profileMap.get(id),
    findSession: (id) => sessions.get(id),
    hasSession: (id) => sessions.has(id),
    getActiveSessionId: () => activeId,
    isViewing: () => false,
    notify: () => undefined,
    events: new EventBus(),
  });
  return { hw, addSession: (id: string) => { sessions.set(id, { id, profileId: "p", cwd: "/w" } as SessionMeta); return id; }, setActive: (id: string) => { activeId = id; } };
}

function makeProfile(): CliProfile {
  return { id: "p", name: "omp", command: "true", args: [], triggers: [] } as CliProfile;
}

describe("activityReport", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("300ms 尾沿全量上报快照;无变化跳过 IPC;开轮/结算翻转各发一次", async () => {
    const calls: ActivitySnapshotEntry[][] = [];
    const orig = ipc.sessionReportActivity;
    ipc.sessionReportActivity = (entries) => (calls.push(entries), Promise.resolve());
    try {
      const { hw, addSession, setActive } = makeWatches([makeProfile()]);
      const id = addSession("s1");
      setActive(id);
      hw.onUserWrite(id, false);
      await vi.advanceTimersByTimeAsync(300); /* 构造期清板推送(仅 awaiting 锚,双 false) */
      expect(calls).toEqual([[{ id: "s1", turnActive: false, unread: false }]]);
      await vi.advanceTimersByTimeAsync(200); // 出 400ms 回显窗:后续内容算应答证据
      hw.appendOutput(id, "answer body"); // 开轮
      await vi.advanceTimersByTimeAsync(300);
      expect(calls[1]).toEqual([{ id: "s1", turnActive: true, unread: false }]);
      hw.appendOutput(id, "more body");
      await vi.advanceTimersByTimeAsync(300);
      expect(calls).toHaveLength(2); /* 同态:签名未变不发 */
      await vi.advanceTimersByTimeAsync(3_000); // 静默 2s 出窗结算(tick 1s 节拍)+ 300ms 尾沿
      expect(calls).toHaveLength(3);
      expect(calls[2]).toEqual([{ id: "s1", turnActive: false, unread: true }]);
    } finally {
      ipc.sessionReportActivity = orig;
    }
  });
});
