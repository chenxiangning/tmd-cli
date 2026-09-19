/**
 * cli-omp 杂项契约测试(主:quota.ts;并入:prewarmFs / prewarmTimings / configDetails)。
 * 覆盖契约:
 * - fetchOmpQuota 路由判别:模型前缀 → vendor 识别;未识别模型/供应商显式报错不读凭据;
 *   codex 恒走本地快照通道(无凭据不报未登录);非 codex 未登录报错不发 HTTP;
 *   凭据 data JSON 边界解析(非 object / 空白裁剪 / 非法字段丢弃)经查询参数可观察。
 * - pickPrewarmCwd:7 天活动窗边界(严格小于才过期)、头部 cwd 行逐行解析与跳过、
 *   ipc 任何失败恒吞错返回 null。
 * - lockAndRemoveBirthFile:恰好一个新增且无用户消息才删;多个/零个/有用户消息/无桶/扫描失败全不碰。
 * - prewarmTimings:时序常量间不变量(特征等待 < 回收上限;清理轮递增且先于回收)。
 * - OMP_FIELD_DETAILS:说明键与 configGui schema 字段一一对应,条条非空且含结构词,roles 覆盖 9 角色。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuotaFetchContext, QuotaSnapshot } from "@kernel/quota";
import type * as VendorsModule from "../cli-shared/quota/vendors";

vi.mock("../cli-shared/quota/ompAuth", () => ({ readOmpAuthCredential: vi.fn() }));
vi.mock("../cli-shared/quota/codexLocal", () => ({ fetchCodexQuotaWithSnapshot: vi.fn() }));
// vendors 桶部分 mock:保留真路由判别(vendorFromModel / detectVendorByProviderId),
// 只替掉 HTTP 面与塑形出口。
vi.mock("../cli-shared/quota/vendors", async (importOriginal) => {
  const actual = await importOriginal<typeof VendorsModule>();
  return { ...actual, fetchVendorQuota: vi.fn(), toQuotaSnapshot: vi.fn() };
});
vi.mock("@kernel/ipc", () => ({
  ipc: { configHomeDir: vi.fn(), fsCollectFiles: vi.fn(), fsReadHead: vi.fn(), fsRemovePath: vi.fn() },
}));
vi.mock("./edits", () => ({ ompSessionsDir: vi.fn() }));

import { ipc } from "@kernel/ipc";
import { fetchCodexQuotaWithSnapshot } from "../cli-shared/quota/codexLocal";
import { readOmpAuthCredential } from "../cli-shared/quota/ompAuth";
import { fetchVendorQuota, toQuotaSnapshot } from "../cli-shared/quota/vendors";
import { ompConfigEntry } from "./configGui";
import { OMP_FIELD_DETAILS } from "./configDetails";
import { ompSessionsDir } from "./edits";
import { fetchOmpQuota } from "./quota";
import { lockAndRemoveBirthFile, pickPrewarmCwd, RECENT_ACTIVITY_MS } from "./prewarmFs";
import * as timings from "./prewarmTimings";

type Stamp = { name: string; path: string; modifiedAt: number };
const ctxOf = (model: string | null | undefined): QuotaFetchContext => ({ model });
const snapshotSentinel = { windows: [] } as unknown as QuotaSnapshot;

const rootFiles: Stamp[] = [];
const bucketFiles: Stamp[] = [];
let headByPath: Record<string, string> = {};
let nowMs = 1_800_000_000_000;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readOmpAuthCredential).mockReset();
  vi.mocked(fetchCodexQuotaWithSnapshot).mockReset();
  vi.mocked(fetchVendorQuota).mockReset();
  vi.mocked(toQuotaSnapshot).mockReset();
  rootFiles.length = 0;
  bucketFiles.length = 0;
  headByPath = {};
  nowMs = 1_800_000_000_000;
  vi.mocked(ipc.configHomeDir).mockResolvedValue("/home/u");
  vi.mocked(ipc.fsCollectFiles).mockImplementation(async (dir: string) =>
    dir.endsWith("/.omp/agent/sessions") ? [...rootFiles] : [...bucketFiles],
  );
  vi.mocked(ipc.fsReadHead).mockImplementation(async (path: string) => headByPath[path] ?? "");
  vi.mocked(ipc.fsRemovePath).mockResolvedValue(undefined);
  vi.mocked(ompSessionsDir).mockResolvedValue("/home/u/.omp/agent/sessions/-ws1");
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchOmpQuota 路由与凭据适配", () => {
  it.each([
    ["空模型", ""],
    ["模型缺省", undefined],
    ["双下划线哨兵模型", "__prewarm__/m"],
  ])("%s → 报未识别且不读凭据", async (_name, model) => {
    await expect(fetchOmpQuota(ctxOf(model))).rejects.toThrow("未识别当前模型");
    expect(readOmpAuthCredential).not.toHaveBeenCalled();
  });

  it("未识别 provider id → 报暂不支持并带上原始前缀,不发 HTTP", async () => {
    await expect(fetchOmpQuota(ctxOf("my-relay/grok"))).rejects.toThrow(/my-relay/);
    await expect(fetchOmpQuota(ctxOf("my-relay/grok"))).rejects.toThrow(/暂不支持/);
    expect(readOmpAuthCredential).not.toHaveBeenCalled();
    expect(fetchVendorQuota).not.toHaveBeenCalled();
  });

  it("kimi-code 路由到 kimi:以原始 provider id 取凭据,查询与塑形按归一 vendor", async () => {
    vi.mocked(readOmpAuthCredential).mockResolvedValue('{"key": " sk-kimi-1 "}');
    vi.mocked(fetchVendorQuota).mockResolvedValue({ windows: [], planLabel: "Plan-A" });
    vi.mocked(toQuotaSnapshot).mockReturnValue(snapshotSentinel);

    await expect(fetchOmpQuota(ctxOf("kimi-code/k3"))).resolves.toBe(snapshotSentinel);

    expect(readOmpAuthCredential).toHaveBeenCalledWith("kimi-code");
    expect(fetchVendorQuota).toHaveBeenCalledWith("kimi", { key: "sk-kimi-1" });
    expect(toQuotaSnapshot).toHaveBeenCalledWith("kimi-code", "kimi", { windows: [], planLabel: "Plan-A" });
  });

  it("非 codex 未登录 → 报未登录并提示 agent.db 路径,不发 HTTP", async () => {
    vi.mocked(readOmpAuthCredential).mockResolvedValue(null);
    await expect(fetchOmpQuota(ctxOf("kimi-code/k3"))).rejects.toThrow(/未登录/);
    await expect(fetchOmpQuota(ctxOf("kimi-code/k3"))).rejects.toThrow(/agent\.db/);
    expect(fetchVendorQuota).not.toHaveBeenCalled();
    expect(toQuotaSnapshot).not.toHaveBeenCalled();
  });

  it("codex 无凭据也走本地快照通道且不报未登录", async () => {
    vi.mocked(readOmpAuthCredential).mockResolvedValue(null);
    vi.mocked(fetchCodexQuotaWithSnapshot).mockResolvedValue(snapshotSentinel);

    await expect(fetchOmpQuota(ctxOf("openai-codex/gpt-5"))).resolves.toBe(snapshotSentinel);

    expect(fetchCodexQuotaWithSnapshot).toHaveBeenCalledWith({}, "openai-codex");
    expect(fetchVendorQuota).not.toHaveBeenCalled();
  });

  it("codex oauth 凭据解析后透传给快照通道", async () => {
    vi.mocked(readOmpAuthCredential).mockResolvedValue('{"access":" at-1 ","accountId":"acc-9"}');
    vi.mocked(fetchCodexQuotaWithSnapshot).mockResolvedValue(snapshotSentinel);

    await fetchOmpQuota(ctxOf("openai-codex/gpt-5"));

    expect(fetchCodexQuotaWithSnapshot).toHaveBeenCalledWith({ access: "at-1", accountId: "acc-9" }, "openai-codex");
  });

  it("凭据 data JSON 为标量(含字面 null)→ 按空凭据继续查询,不当未登录", async () => {
    vi.mocked(readOmpAuthCredential).mockResolvedValue("null");
    vi.mocked(fetchVendorQuota).mockResolvedValue({ windows: [] });
    vi.mocked(toQuotaSnapshot).mockReturnValue(snapshotSentinel);

    await expect(fetchOmpQuota(ctxOf("kimi-code/k3"))).resolves.toBe(snapshotSentinel);
    expect(fetchVendorQuota).toHaveBeenCalledWith("kimi", {});
  });

  it("凭据字段空白串视为缺失、非字符串字段丢弃、合法值裁剪", async () => {
    vi.mocked(readOmpAuthCredential).mockResolvedValue('{"key":"  ","access":" acc-1 ","accountId":42}');
    vi.mocked(fetchVendorQuota).mockResolvedValue({ windows: [] });

    await fetchOmpQuota(ctxOf("kimi-code/k3"));

    expect(fetchVendorQuota).toHaveBeenCalledWith("kimi", { access: "acc-1" });
  });
});

describe("pickPrewarmCwd 预热目标发现", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(nowMs);
  });

  it("最近活动恰好在 7 天边界上不判过期(严格小于才丢弃)", async () => {
    const p = "/home/u/.omp/agent/sessions/b1/latest.jsonl";
    rootFiles.push({ name: "latest.jsonl", path: p, modifiedAt: nowMs - RECENT_ACTIVITY_MS });
    headByPath[p] = '{"cwd":"/w/proj"}\n';
    await expect(pickPrewarmCwd()).resolves.toBe("/w/proj");
  });

  it("超过活动窗即判过期:不读文件头直接放弃", async () => {
    rootFiles.push({
      name: "old.jsonl",
      path: "/home/u/.omp/agent/sessions/b1/old.jsonl",
      modifiedAt: nowMs - RECENT_ACTIVITY_MS - 1,
    });
    await expect(pickPrewarmCwd()).resolves.toBeNull();
    expect(ipc.fsReadHead).not.toHaveBeenCalled();
  });

  it("无会话文件 → null", async () => {
    await expect(pickPrewarmCwd()).resolves.toBeNull();
  });

  it("头部无 cwd 行 → null", async () => {
    const p = "/home/u/.omp/agent/sessions/b1/a.jsonl";
    rootFiles.push({ name: "a.jsonl", path: p, modifiedAt: nowMs });
    headByPath[p] = '{"type":"session"}\n{"title":"hi"}\n';
    await expect(pickPrewarmCwd()).resolves.toBeNull();
  });

  it("截断 JSON 行(含 cwd 字样解析失败)跳过后命中后续完整行", async () => {
    const p = "/home/u/.omp/agent/sessions/b1/a.jsonl";
    rootFiles.push({ name: "a.jsonl", path: p, modifiedAt: nowMs });
    headByPath[p] = '{"type":"x","cwd":"/w/trunc"\n{"cwd":"/w/real"}\n';
    await expect(pickPrewarmCwd()).resolves.toBe("/w/real");
  });

  it("cwd 空串视为缺失继续找,后续行命中", async () => {
    const p = "/home/u/.omp/agent/sessions/b1/a.jsonl";
    rootFiles.push({ name: "a.jsonl", path: p, modifiedAt: nowMs });
    headByPath[p] = '{"cwd":""}\n{"cwd":"/w/next"}\n';
    await expect(pickPrewarmCwd()).resolves.toBe("/w/next");
  });

  it("家目录为空或 ipc 失败 → 恒吞错返回 null", async () => {
    vi.mocked(ipc.configHomeDir).mockResolvedValue("");
    await expect(pickPrewarmCwd()).resolves.toBeNull();
    vi.mocked(ipc.configHomeDir).mockRejectedValue(new Error("boom"));
    await expect(pickPrewarmCwd()).resolves.toBeNull();
  });
});

describe("lockAndRemoveBirthFile 出生空会话锁定清理", () => {
  it("恰好一个新增且头部无用户消息 → 删除该文件", async () => {
    bucketFiles.push(
      { name: "born.jsonl", path: "/bucket/born.jsonl", modifiedAt: 1 },
      { name: "fresh.jsonl", path: "/bucket/fresh.jsonl", modifiedAt: 2 },
    );
    headByPath["/bucket/fresh.jsonl"] = '{"type":"session","cwd":"/w"}\n';
    await lockAndRemoveBirthFile("/w", new Set(["born.jsonl"]));
    expect(ipc.fsRemovePath).toHaveBeenCalledWith("/bucket/fresh.jsonl");
  });

  it("新增文件头部已出现用户消息 → 绝不删", async () => {
    bucketFiles.push({ name: "fresh.jsonl", path: "/bucket/fresh.jsonl", modifiedAt: 2 });
    headByPath["/bucket/fresh.jsonl"] = '{"role":"user","content":"hi"}\n';
    await lockAndRemoveBirthFile("/w", new Set());
    expect(ipc.fsRemovePath).not.toHaveBeenCalled();
  });

  it("新增数大于一(预热期用户手动开会话)→ 全部不碰且不读头", async () => {
    bucketFiles.push(
      { name: "a.jsonl", path: "/bucket/a.jsonl", modifiedAt: 1 },
      { name: "b.jsonl", path: "/bucket/b.jsonl", modifiedAt: 2 },
    );
    await lockAndRemoveBirthFile("/w", new Set());
    expect(ipc.fsReadHead).not.toHaveBeenCalled();
    expect(ipc.fsRemovePath).not.toHaveBeenCalled();
  });

  it("零新增 → 不碰", async () => {
    bucketFiles.push({ name: "born.jsonl", path: "/bucket/born.jsonl", modifiedAt: 1 });
    await lockAndRemoveBirthFile("/w", new Set(["born.jsonl"]));
    expect(ipc.fsRemovePath).not.toHaveBeenCalled();
  });

  it("定位不到会话桶 → 不碰", async () => {
    vi.mocked(ompSessionsDir).mockResolvedValue(null);
    await lockAndRemoveBirthFile("/w", new Set());
    expect(ipc.fsCollectFiles).not.toHaveBeenCalled();
  });

  it("桶扫描失败 → 吞错不抛", async () => {
    vi.mocked(ipc.fsCollectFiles).mockRejectedValue(new Error("boom"));
    await expect(lockAndRemoveBirthFile("/w", new Set())).resolves.toBeUndefined();
  });
});

describe("prewarmTimings 时序不变量", () => {
  it("特征等待上限必须小于回收上限:等待期内不回收进程", () => {
    expect(timings.RESUME_TIMEOUT_MS).toBeLessThan(timings.IDLE_REAP_MS);
  });

  it("出生清理轮严格递增且全部赶在回收上限前完成", () => {
    const d = timings.BIRTH_LOCK_DELAYS_MS;
    expect(d.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThan(d[i - 1]);
    expect(d[d.length - 1]).toBeLessThan(timings.IDLE_REAP_MS);
  });

  it("就绪等待覆盖实测启动成本(首屏+扩展加载)且提交节奏为正", () => {
    expect(timings.READY_DELAY_MS).toBeGreaterThanOrEqual(5_100);
    expect(timings.INJECT_SPLIT_MS).toBeGreaterThan(0);
    expect(timings.READY_DELAY_MS).toBeGreaterThan(timings.INJECT_SPLIT_MS);
  });
});

describe("OMP_FIELD_DETAILS 新手说明", () => {
  it("说明键与 configGui schema 字段一一对应(不多不少)", () => {
    expect(Object.keys(OMP_FIELD_DETAILS).sort()).toEqual(ompConfigEntry.fields.map((f) => f.id).sort());
  });

  it("每条说明非空且含「解决什么问题 / 影响什么」结构", () => {
    for (const [id, text] of Object.entries(OMP_FIELD_DETAILS)) {
      expect(text.length, id).toBeGreaterThan(20);
      expect(text, id).toContain("解决什么问题");
      expect(text, id).toContain("影响什么");
    }
  });

  it("roles 说明覆盖全部 9 个角色", () => {
    for (const role of ["default", "smol", "slow", "plan", "advisor", "commit", "reasoning", "title", "memory"]) {
      expect(OMP_FIELD_DETAILS.roles).toContain(role);
    }
  });

  it("schema 装配后每个字段都带上了说明", () => {
    for (const f of ompConfigEntry.fields) expect(f.detail, f.id).toBeTruthy();
  });
});
