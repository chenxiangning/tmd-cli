/**
 * 时间线 sheet 测试(spec 2026-10-05-mobile-session-timeline):
 * 支持面分发(置灰判据)/ 尾窗可达判定 / loadTimeline 全链(mock 桥 IO:
 * 定位 → 2MB 尾读 → cli-shared 行解析;定位链细节由 sessionFile.test.ts 另钉)。
 */
import { describe, expect, it, vi } from "vitest";

const fsReadTailChanged = vi.fn();

vi.mock("@kernel/ipc", () => ({
  ipc: {
    configHomeDir: async () => "/home/u",
    fsReadTailChanged: (...a: unknown[]) => fsReadTailChanged(...a),
  },
}));

vi.mock("@kernel/transport", () => ({
  invoke: async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === "config_home_dir") return "/home/u";
    if (cmd === "fs_collect_files") {
      return [
        { path: `${args.dir}/2026-10-05T00-00-00-000Z_11111111-2222-4333-8444-555555555555.jsonl`, modifiedAt: 2 },
      ];
    }
    if (cmd === "fs_read_head") return "";
    return [];
  },
}));

import { loadTimeline, reachableTexts, timelineSupported } from "./timelineData";

const CWD = "/Users/x/code/tmd-cli";
const SID = "11111111-2222-4333-8444-555555555555";

const ompJsonl = [
  JSON.stringify({ type: "message", id: "m1", message: { role: "user", content: [{ type: "text", text: "第一问" }] } }),
  JSON.stringify({ type: "message", id: "m2", message: { role: "assistant", content: [{ type: "text", text: "答" }] } }),
  JSON.stringify({ type: "message", id: "m3", message: { role: "user", content: [{ type: "text", text: "第二问" }] } }),
].join("\n");

describe("timelineSupported(第五格置灰判据)", () => {
  it("契约引擎亮(大小写不敏感);契约外与缺省灰", () => {
    for (const p of ["omp", "pi", "claude", "cl", "codex", "kimi", "OMP"]) expect(timelineSupported(p)).toBe(true);
    for (const p of ["qoder", "grok", "dsh", "opencode", "shell", undefined]) {
      expect(timelineSupported(p)).toBe(false);
    }
  });
});

describe("reachableTexts(尾窗可达判定)", () => {
  it("user turn 文本入集;tool/assistant/null 不入;重复去重", () => {
    const turns = [
      { role: "user", text: "去修登录" },
      { role: "assistant", text: "去修登录" },
      { role: "tool", text: "去修登录", tool: "bash" },
      { role: "user", text: "去修登录" },
    ] as never;
    const reach = reachableTexts(turns);
    expect(reach.size).toBe(1);
    expect(reach.has("去修登录")).toBe(true);
    expect(reach.has("不存在")).toBe(false);
    expect(reachableTexts(null).size).toBe(0);
  });
});

describe("loadTimeline(定位 → 2MB 尾读 → 行解析)", () => {
  it("omp 全链:按 id 绑定文件,用户消息按文件序(最旧在前)", async () => {
    fsReadTailChanged.mockResolvedValueOnce({ changed: true, size: ompJsonl.length, text: ompJsonl });
    const r = await loadTimeline("omp", CWD, SID);
    expect(r?.messages.map((m) => m.text)).toEqual(["第一问", "第二问"]);
    expect(r?.messages[0]?.id).toBe("m1");
    expect(r?.truncated).toBe(false);
    expect(fsReadTailChanged).toHaveBeenCalledWith(expect.stringContaining(SID), 2 * 1024 * 1024, null);
  });

  it("size 超 2MB 窗 → truncated(超窗注记,不谎称全量)", async () => {
    fsReadTailChanged.mockResolvedValueOnce({ changed: true, size: 3 * 1024 * 1024, text: ompJsonl });
    const r = await loadTimeline("omp", CWD, SID);
    expect(r?.truncated).toBe(true);
  });

  it("文件未找到(jsonl 懒落盘)→ null(可重试态,非空结果)", async () => {
    fsReadTailChanged.mockClear();
    fsReadTailChanged.mockResolvedValue({ changed: true, size: 0, text: "" });
    /* 同 cwd 目录空:mock 通用目录只有 omp/pi/claude 分支会到;codex 走全局树
       探测(读头无 meta)→ null。 */
    expect(await loadTimeline("codex", CWD, "no-such-session")).toBeNull();
    expect(fsReadTailChanged).not.toHaveBeenCalled();
  });

  it("读取失败 → reject 上抛(调用方渲染错误态,不当空)", async () => {
    fsReadTailChanged.mockRejectedValueOnce(new Error("EIO"));
    await expect(loadTimeline("omp", CWD, SID)).rejects.toThrow("EIO");
  });
});
