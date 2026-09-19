/**
 * ompAuth.ts(omp agent.db 凭据读取)契约测试。
 *
 * 覆盖契约:
 * - 库路径固定 <home>/.omp/agent/agent.db,home 尾斜杠被去除(不产生双斜杠)
 * - listOmpAuthProviders:取每行首列字符串,非字符串单元格被过滤
 * - readOmpAuthCredential:返回最新一行 data 字符串,并按 provider 绑定查询参数
 * - 库缺失/查询失败一律回落空结果(listOmp → [],readOmp → null),不抛错
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@kernel/ipc", () => ({
  ipc: { sqliteQuery: vi.fn(), configHomeDir: vi.fn() },
}));

import { ipc } from "@kernel/ipc";
import { listOmpAuthProviders, readOmpAuthCredential } from "./ompAuth";

const sqliteQuery = vi.mocked(ipc.sqliteQuery);
const configHomeDir = vi.mocked(ipc.configHomeDir);

beforeEach(() => {
  sqliteQuery.mockReset();
  sqliteQuery.mockResolvedValue([]);
  configHomeDir.mockReset();
  configHomeDir.mockResolvedValue("/home/u");
});

describe("listOmpAuthProviders", () => {
  it("读固定库路径,取首列字符串并过滤非字符串单元格", async () => {
    sqliteQuery.mockResolvedValue([["kimi"], [42], [null], ["zhipu-cn"]]);
    await expect(listOmpAuthProviders()).resolves.toEqual(["kimi", "zhipu-cn"]);
    expect(sqliteQuery.mock.calls[0][0]).toBe("/home/u/.omp/agent/agent.db");
    expect(sqliteQuery.mock.calls[0][2]).toEqual([]);
  });

  it("home 带尾斜杠时路径不出现双斜杠", async () => {
    configHomeDir.mockResolvedValue("/home/u/");
    await listOmpAuthProviders();
    expect(sqliteQuery.mock.calls[0][0]).toBe("/home/u/.omp/agent/agent.db");
  });

  it("查询失败按空表处理,不抛错", async () => {
    sqliteQuery.mockRejectedValue(new Error("库不存在"));
    await expect(listOmpAuthProviders()).resolves.toEqual([]);
  });
});

describe("readOmpAuthCredential", () => {
  it("返回首行 data 字符串,并按 provider 绑定参数", async () => {
    sqliteQuery.mockResolvedValue([['{"token":"t"}']]);
    await expect(readOmpAuthCredential("kimi")).resolves.toBe('{"token":"t"}');
    expect(sqliteQuery.mock.calls[0][2]).toEqual(["kimi"]);
  });

  it("无记录/查询失败/非字符串 data → null 不抛错", async () => {
    sqliteQuery.mockResolvedValue([]);
    await expect(readOmpAuthCredential("kimi")).resolves.toBeNull();
    sqliteQuery.mockRejectedValue(new Error("boom"));
    await expect(readOmpAuthCredential("kimi")).resolves.toBeNull();
    sqliteQuery.mockResolvedValue([[123]]);
    await expect(readOmpAuthCredential("kimi")).resolves.toBeNull();
  });
});
