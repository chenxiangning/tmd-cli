/**
 * pi quota 纯路由契约测试。
 * 覆盖:provider 前缀路由、裸 modelId 反查消歧、models.json 中转站凭据、
 * $ENV_VAR 引用解析、!command 拒绝执行。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@kernel/ipc", () => ({
  ipc: {
    quotaEnvValue: async (name: string) =>
      name === "TEST_RELAY_KEY" ? "sk-env-resolved" : null,
  },
}));

import { vendorFromModel } from "../cli-shared/quota/vendors";
import {
  parseJsonc,
  providersForModelId,
  resolveCredentialRefs,
  resolvePiRoute,
  type PiLocalConfig,
} from "./quota";

const BASE: PiLocalConfig = { auth: {}, store: {}, modelsJson: {} };

describe("vendorFromModel", () => {
  it("provider/model → provider", () => {
    expect(vendorFromModel("zai-coding-cn/glm-5.2")).toBe("zai-coding-cn");
  });
  it("哨兵与空值返回 null;裸 id 由 resolvePiRoute 另行反查", () => {
    expect(vendorFromModel("__auto__")).toBeNull();
    expect(vendorFromModel(null)).toBeNull();
    expect(vendorFromModel("")).toBeNull();
  });
});

describe("resolvePiRoute 前缀路由", () => {
  const config: PiLocalConfig = {
    ...BASE,
    auth: { "kimi-coding": { key: "kk" }, "zai-coding-cn": { key: "zz" } },
  };

  it("模型前缀 kimi-code 与 auth key kimi-coding 语义匹配", () => {
    const route = resolvePiRoute(config, "kimi-code/k3");
    expect(route.vendor).toBe("kimi");
    expect(route.credential.key).toBe("kk");
  });

  it("glm 前缀模型命中 zhipu-cn,凭据来自 zai-coding-cn", () => {
    const route = resolvePiRoute(config, "glm/glm-5.2");
    expect(route.vendor).toBe("zhipu-cn");
    expect(route.credential.key).toBe("zz");
  });

  it("精确 provider key 优先于语义匹配", () => {
    const route = resolvePiRoute(config, "zai-coding-cn/glm-5.2");
    expect(route.providerId).toBe("zai-coding-cn");
    expect(route.credential.key).toBe("zz");
  });
});

describe("resolvePiRoute 裸 modelId 反查", () => {
  const config: PiLocalConfig = {
    ...BASE,
    auth: { deepseek: { key: "ds" } },
    store: {
      deepseek: { models: [{ id: "deepseek-v4-flash" }] },
      "opencode-go": { models: [{ id: "deepseek-v4-flash" }, { id: "glm-5.1" }] },
    },
    modelsJson: {
      "opencode-go": { apiKey: "relay-key", baseUrl: "https://relay.example.com/v1" },
    },
  };

  it("双候选都有凭据 → 拒绝猜测", () => {
    expect(() => resolvePiRoute(config, "deepseek-v4-flash")).toThrow("无法路由");
  });

  it("唯一有凭据的候选胜出(中转站走 models.json apiKey)", () => {
    const route = resolvePiRoute(config, "glm-5.1");
    expect(route.providerId).toBe("opencode-go");
    expect(route.vendor).toBe("relay");
    expect(route.baseUrl).toBe("https://relay.example.com/v1");
    expect(route.credential.key).toBe("relay-key");
  });

  it("候选无凭据 → 明确报错", () => {
    const noCred: PiLocalConfig = {
      ...BASE,
      store: { foo: { models: [{ id: "m1" }] } },
      modelsJson: { foo: { baseUrl: "https://x.example.com" } },
    };
    expect(() => resolvePiRoute(noCred, "m1")).toThrow("均无凭据");
  });
});

describe("resolvePiRoute 未知/缺失模型", () => {
  it("中转站 provider 前缀走 models.json baseUrl → relay", () => {
    const config: PiLocalConfig = {
      ...BASE,
      modelsJson: {
        "my-relay": { baseUrl: "https://fufei.example.com/v1", apiKey: "sk-1" },
      },
    };
    const route = resolvePiRoute(config, "my-relay/grok-4.6");
    expect(route.vendor).toBe("relay");
    expect(route.baseUrl).toBe("https://fufei.example.com/v1");
    expect(route.credential.key).toBe("sk-1");
  });

  it("无 model 且多供应商 → 拒绝;单供应商 → 安全回退", () => {
    const multi: PiLocalConfig = {
      ...BASE,
      auth: { a: { key: "1" }, deepseek: { key: "2" } },
    };
    expect(() => resolvePiRoute(multi, null)).toThrow("无法路由");
    const single: PiLocalConfig = { ...BASE, auth: { deepseek: { key: "ds" } } };
    expect(resolvePiRoute(single, null).vendor).toBe("deepseek");
  });

  it("openai-codex 走本地快照,无凭据也可路由", () => {
    const route = resolvePiRoute(BASE, "openai-codex/gpt-5.6");
    expect(route.vendor).toBe("openai-codex");
    expect(route.credential).toEqual({});
  });

  it("未知供应商且无 baseUrl → 报错", () => {
    expect(() => resolvePiRoute(BASE, "mystery/model")).toThrow("无 baseUrl");
  });
});

describe("resolveCredentialRefs ($ENV_VAR / !command)", () => {
  it("$ENV_VAR 从环境变量解析", async () => {
    const cred = await resolveCredentialRefs("p", { key: "$TEST_RELAY_KEY" });
    expect(cred.key).toBe("sk-env-resolved");
  });

  it("未设置的环境变量 → 明确报错", async () => {
    await expect(resolveCredentialRefs("p", { key: "$MISSING_VAR" })).rejects.toThrow(
      "环境变量 MISSING_VAR 未设置",
    );
  });

  it("!command 引用 → 拒绝执行 shell", async () => {
    await expect(resolveCredentialRefs("p", { key: "!cat ~/.secret" })).rejects.toThrow(
      "不执行 shell",
    );
  });

  it("纯值原样返回", async () => {
    const cred = await resolveCredentialRefs("p", { key: "sk-plain", access: "acc" });
    expect(cred.key).toBe("sk-plain");
    expect(cred.access).toBe("acc");
  });
});

describe("parseJsonc", () => {
  it("剥离行注释、块注释与尾逗号", () => {
    const parsed = parseJsonc(`{
      // 行注释
      "providers": {
        "r": { "baseUrl": "https://a.com/v1", /* 块注释 */ "apiKey": "k" },
      },
    }`) as { providers: Record<string, { baseUrl: string; apiKey: string }> };
    expect(parsed.providers.r.baseUrl).toBe("https://a.com/v1");
    expect(parsed.providers.r.apiKey).toBe("k");
  });

  it("字符串内的 // 与 /* 不受影响", () => {
    const parsed = parseJsonc(`{"u": "https://x.com/*path"}`) as { u: string };
    expect(parsed.u).toBe("https://x.com/*path");
  });
});

describe("providersForModelId", () => {
  it("store 优先,models.json 补充去重", () => {
    const out = providersForModelId(
      {
        store: { a: { models: [{ id: "m" }] } },
        modelsJson: { a: { models: [{ id: "m" }] }, b: { models: [{ id: "m" }] } },
      },
      "m",
    );
    expect(out).toEqual(["a", "b"]);
  });
});
