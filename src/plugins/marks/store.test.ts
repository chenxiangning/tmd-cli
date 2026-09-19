/**
 * store 持久化与状态机回归测试 —— review 修复锚点:
 * ① 删除墓碑:removeMark 后 persist 不得把磁盘旧条目并回复活;
 * ② relocate 跳过 staged(芯片条不得静默消失);
 * ③ isMark 行号域校验(startLine>=1 且 endLine>=startLine)。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@kernel/ipc", () => {
  const disk = new Map<string, string>();
  return {
    ipc: {
      configHomeDir: () => Promise.resolve("/home/t"),
      fsCreateDir: () => Promise.resolve(),
      fsReadFile: (path: string) =>
        disk.has(path) ? Promise.resolve(disk.get(path)!) : Promise.reject(new Error("ENOENT")),
      fsWriteFile: (path: string, text: string) => {
        disk.set(path, text);
        return Promise.resolve();
      },
    },
    __disk: disk,
  };
});

import * as ipcMod from "@kernel/ipc";
import { addMark, marksSnapshot, relocatePath, removeMark, setMarkState } from "./store";

const disk = (ipcMod as unknown as { __disk: Map<string, string> }).__disk;
const CWD = "/repo/st";
const LINES = ["l1", "l2", "l3", "l4", "l5"];

function reset(): void {
  disk.clear();
  for (const [cwd, marks] of Object.entries(marksSnapshot().byCwd))
    for (const m of [...marks]) removeMark(cwd, m.id);
}

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(500);
  /* persist 内部还有两轮 await(home/读盘),让微任务排空 */
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("marks store 持久化契约", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reset();
  });

  it("删除墓碑:removeMark 后落盘不复活(review P1)", async () => {
    const a = addMark({ cwd: CWD, path: "/repo/st/a.ts", startLine: 1, endLine: 1, lines: LINES });
    await flush();
    const written = [...disk.values()][0];
    expect(written).toContain(a.id);

    removeMark(CWD, a.id);
    await flush();
    /* 读-合并-写回路径上,墓碑 id 必须被跳过 */
    const after = [...disk.values()][0];
    expect(after).not.toContain(a.id);
    expect(marksSnapshot().byCwd[CWD] ?? []).toHaveLength(0);
  });

  it("relocate 跳过 staged/sent,芯片条不静默消失(review P2)", () => {
    const staged = addMark({ cwd: CWD, path: "/repo/st/a.ts", startLine: 2, endLine: 2, lines: LINES });
    setMarkState(CWD, staged.id, "staged");
    const sent = addMark({ cwd: CWD, path: "/repo/st/a.ts", startLine: 3, endLine: 3, lines: LINES });
    setMarkState(CWD, sent.id, "sent");
    const pending = addMark({ cwd: CWD, path: "/repo/st/a.ts", startLine: 4, endLine: 4, lines: LINES });

    /* 文件内容整体下移一行:l2→l3、l3→l4、l4→l5 */
    relocatePath(CWD, "/repo/st/a.ts", ["x", ...LINES]);
    const marks = marksSnapshot().byCwd[CWD];
    expect(marks.find((m) => m.id === staged.id)?.state).toBe("staged");
    expect(marks.find((m) => m.id === staged.id)?.startLine).toBe(2);
    expect(marks.find((m) => m.id === sent.id)?.startLine).toBe(3);
    expect(marks.find((m) => m.id === pending.id)?.startLine).toBe(5);
  });

  it("脏数据守卫:startLine<1 或 endLine<startLine 的盘条目合并时滤掉(review P3)", async () => {
    const { dirKey } = await import("./store");
    disk.set(
      `/home/t/.tmd-cli/marks/${dirKey(CWD)}.json`,
      JSON.stringify({
        version: 1,
        marks: [
          { id: "bad1", path: "a", startLine: 0, endLine: 2, fingerprint: { body: "x", context: "y" }, note: "", state: "pending", createdAt: 1 },
          { id: "bad2", path: "a", startLine: 5, endLine: 2, fingerprint: { body: "x", context: "y" }, note: "", state: "pending", createdAt: 1 },
          { id: "old", path: "a", startLine: 2, endLine: 3, fingerprint: { body: "x", context: "y" }, note: "", state: "pending", createdAt: 1 },
        ],
      }),
    );
    const fresh = addMark({ cwd: CWD, path: "/repo/st/c.ts", startLine: 1, endLine: 1, lines: LINES });
    await flush();
    const written = JSON.parse(disk.get(`/home/t/.tmd-cli/marks/${dirKey(CWD)}.json`)!) as { marks: { id: string }[] };
    const ids = written.marks.map((m) => m.id);
    expect(ids).toContain(fresh.id);
    expect(ids).toContain("old");
    expect(ids).not.toContain("bad1");
    expect(ids).not.toContain("bad2");
  });
});
