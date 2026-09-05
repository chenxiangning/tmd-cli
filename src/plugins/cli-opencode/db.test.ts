/**
 * opencode.db 行解析纯函数单测 —— 行格式契约守卫。
 * 样例取自本机真实库行(2026-09-05,opencode 1.18.25)。
 */
import { describe, expect, it, vi } from "vitest";

/* db.ts import 链带 ipc;查询函数用例以桩验证 SQL 形态与窗口语义。 */
const sqliteQuery = vi.fn(
  async (_db: string, _sql: string, _params: string[]) => [] as unknown[][],
);
vi.mock("@kernel/ipc", () => ({
  ipc: {
    configHomeDir: vi.fn(async () => "/home"),
    quotaEnvValue: vi.fn(async () => null),
    sqliteQuery: (db: string, sql: string, params: string[]) => sqliteQuery(db, sql, params),
  },
}));

import {
  opencodeDiskSessionRows,
  opencodeIdentityRow,
  opencodeSessionStatus,
  opencodeUserMessageRows,
  parseOpencodeMessageModel,
  parseOpencodeModelVariant,
  parseOpencodeToolEdit,
  readOpencodeUserMessages,
} from "./db";

describe("opencodeDiskSessionRows(会话行 → CliDiskSession)", () => {
  it("正常行:合成路径 <db>#<id>,mtime 取 time_created", () => {
    const rows = [
      ["ses_abc", "打招呼", 1787986042610, 1787986055749],
      ["ses_def", "", 100, 200],
    ];
    expect(opencodeDiskSessionRows("/data/opencode.db", rows)).toEqual([
      {
        id: "ses_abc",
        title: "打招呼",
        modifiedAt: 1787986042610,
        path: "/data/opencode.db#ses_abc",
      },
      { id: "ses_def", title: undefined, modifiedAt: 100, path: "/data/opencode.db#ses_def" },
    ]);
  });

  it("id 缺失/异型行跳过;time_created 异型回退 time_updated", () => {
    const rows = [
      [null, "x", 1, 2],
      ["ses_ok", "t", "bad", 42],
    ];
    const out = opencodeDiskSessionRows("/db", rows);
    expect(out).toHaveLength(1);
    expect(out[0].modifiedAt).toBe(42);
  });
});

describe("opencodeIdentityRow(身份自证行)", () => {
  it("directory + time_created 自证", () => {
    expect(opencodeIdentityRow("ses_1", ["/w", 1787986042610])).toEqual({
      id: "ses_1",
      cwd: "/w",
      createdAt: 1787986042610,
    });
  });
  it("空行 = null(cwd/createdAt 缺失按契约交给内核其余维度)", () => {
    expect(opencodeIdentityRow("ses_1", null)).toBeNull();
  });
});

describe("parseOpencodeMessageModel(最新消息模型)", () => {
  it("真实 user 消息形状 → provider/model", () => {
    expect(
      parseOpencodeMessageModel({
        role: "user",
        time: { created: 1787987487480 },
        model: { providerID: "zhipuai-coding-plan", modelID: "glm-5.2" },
      }),
    ).toEqual({ provider: "zhipuai-coding-plan", model: "glm-5.2" });
  });

  it("assistant 顶层形态与 user 嵌套形态都识别(实证双形态)", () => {
    expect(
      parseOpencodeMessageModel({
        role: "assistant",
        providerID: "opencode",
        modelID: "big-pickle",
      }),
    ).toEqual({ provider: "opencode", model: "big-pickle" });
  });

  it("default 视为未声明;显式档位透传", () => {
    expect(parseOpencodeModelVariant({ id: "m", variant: "default" })).toBeUndefined();
    expect(parseOpencodeModelVariant({ id: "m", variant: "high" })).toBe("high");
    expect(parseOpencodeModelVariant(null)).toBeUndefined();
  });
});

describe("opencodeSessionStatus(状态合成)", () => {
  it("模型拼 provider/model;variant 进 thinkingLevel", () => {
    expect(
      opencodeSessionStatus({ provider: "zhipuai-coding-plan", model: "glm-5.2" }, "high"),
    ).toEqual({ model: "zhipuai-coding-plan/glm-5.2", thinkingLevel: "high" });
  });
  it("两者皆缺 = null(按未刷盘降级)", () => {
    expect(opencodeSessionStatus(null, undefined)).toBeNull();
  });
});

describe("opencodeUserMessageRows(用户消息行)", () => {
  it("同 id 多部件保留首条;text 缺失跳过", () => {
    const rows = [
      ["msg_1", "你好"],
      ["msg_1", "重复部件"],
      ["msg_2", null],
      ["msg_3", "第二句"],
    ];
    expect(opencodeUserMessageRows(rows)).toEqual([
      { id: "msg_1", text: "你好" },
      { id: "msg_3", text: "第二句" },
    ]);
  });
});

describe("parseOpencodeToolEdit(工具部件 → 写入事件)", () => {
  it("已完成 write:filePath + state.time.end", () => {
    expect(
      parseOpencodeToolEdit(
        {
          type: "tool",
          tool: "write",
          state: {
            status: "completed",
            input: { filePath: "src/a.ts" },
            time: { start: 1, end: 1787987490000 },
          },
        },
        undefined,
      ),
    ).toEqual({ path: "src/a.ts", ts: 1787987490000 });
  });
  it("edit 缺 end 回退行 time_created", () => {
    expect(
      parseOpencodeToolEdit(
        { type: "tool", tool: "edit", state: { status: "completed", input: { filePath: "b" } } },
        99,
      ),
    ).toEqual({ path: "b", ts: 99 });
  });
  it("非 write/edit、未完成、无 filePath 均不产出", () => {
    const base = { type: "tool", state: { status: "completed", input: { filePath: "x" } } };
    expect(parseOpencodeToolEdit({ ...base, tool: "read" }, 1)).toBeNull();
    expect(
      parseOpencodeToolEdit({ ...base, tool: "write", state: { status: "pending", input: {} } }, 1),
    ).toBeNull();
    expect(
      parseOpencodeToolEdit(
        { type: "tool", tool: "edit", state: { status: "completed", input: {} } },
        1,
      ),
    ).toBeNull();
    expect(parseOpencodeToolEdit({ type: "text", text: "hi" }, 1)).toBeNull();
  });
});

describe("readOpencodeUserMessages(增量窗口语义,ipc 桩)", () => {
  it("full=false 走 DESC LIMIT 尾窗并反转为正序;full=true 全量正序", async () => {
    sqliteQuery.mockResolvedValueOnce([
      ["msg_3", "第三句"],
      ["msg_2", "第二句"],
      ["msg_1", "第一句"],
    ]);
    const tail = await readOpencodeUserMessages("/w", "ses_1", false);
    expect(tail).toEqual([
      { id: "msg_1", text: "第一句" },
      { id: "msg_2", text: "第二句" },
      { id: "msg_3", text: "第三句" },
    ]);
    const sql = sqliteQuery.mock.calls.at(-1)?.[1] as string;
    expect(sql).toContain("DESC LIMIT 40");

    sqliteQuery.mockResolvedValueOnce([
      ["msg_1", "第一句"],
      ["msg_2", "第二句"],
    ]);
    const full = await readOpencodeUserMessages("/w", "ses_1", true);
    expect(full).toEqual([
      { id: "msg_1", text: "第一句" },
      { id: "msg_2", text: "第二句" },
    ]);
    expect((sqliteQuery.mock.calls.at(-1)?.[1] as string)).not.toContain("LIMIT");
  });
});
