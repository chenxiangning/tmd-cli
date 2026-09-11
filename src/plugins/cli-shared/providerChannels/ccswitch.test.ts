/**
 * cc-switch 解析测试 —— 见 docs/superpowers/specs/2026-09-11-cli-provider-channels-design.md。
 *
 * 覆盖:v2 JSON(object map / array / 坏 entry) + v3 db rows(坏 settingsConfig 跳过) + normalize + dedupe。
 */

import { describe, expect, it } from "vitest";
import {
  dedupeCcSwitchImport,
  normalizeProvider,
  parseCcSwitchDbRows,
  parseCcSwitchJson,
  type CcSwitchDbRow,
} from "./ccswitch";
import type { Channel } from "./types";

describe("parseCcSwitchJson (v2)", () => {
  it("object map 形 + claude/codex 双 apps", () => {
    const text = JSON.stringify({
      apps: {
        claude: {
          providers: {
            p1: { name: "p1", settingsConfig: { env: { ANTHROPIC_BASE_URL: "https://a" } } },
          },
        },
        codex: {
          providers: {
            p2: { name: "p2", settingsConfig: { env: { OPENAI_API_KEY: "k" }, model: "gpt-x" } },
          },
        },
      },
    });
    const m = parseCcSwitchJson(text);
    expect(m.get("claude")?.[0].id).toBe("p1");
    expect(m.get("codex")?.[0].id).toBe("p2");
  });

  it("array 形 providers", () => {
    const text = JSON.stringify({
      apps: {
        codex: {
          providers: [
            { id: "p3", name: "p3", settingsConfig: { env: { OPENAI_API_KEY: "k" } } },
          ],
        },
      },
    });
    expect(parseCcSwitchJson(text).get("codex")?.[0].id).toBe("p3");
  });

  it("缺 apps / 缺 app 静默", () => {
    expect(parseCcSwitchJson("{}").size).toBe(0);
    expect(parseCcSwitchJson('{"apps":{"kimi":{}}}').size).toBe(0);
  });

  it("坏 entry id 跳过", () => {
    const text = JSON.stringify({
      apps: {
        codex: { providers: [{ settingsConfig: {} }, { id: "ok", settingsConfig: {} }] },
      },
    });
    const m = parseCcSwitchJson(text);
    expect(m.get("codex")?.length).toBe(1);
    expect(m.get("codex")?.[0].id).toBe("ok");
  });
});

describe("parseCcSwitchDbRows (v3)", () => {
  it("ANTHROPIC_* → claude;OPENAI_API_KEY / base_url → codex", () => {
    const rows: CcSwitchDbRow[] = [
      { id: "1", name: "n1", settingsConfig: JSON.stringify({ env: { ANTHROPIC_API_KEY: "k" } }) },
      { id: "2", name: "n2", settingsConfig: JSON.stringify({ env: { OPENAI_API_KEY: "k" } }) },
      { id: "3", name: "n3", settingsConfig: JSON.stringify({ base_url: "https://x" }) },
    ];
    const m = parseCcSwitchDbRows(rows);
    expect(m.get("claude")?.length).toBe(1);
    expect(m.get("codex")?.length).toBe(2);
  });

  it("appType 直读优先于启发式(grokbuild 形状也不误判)", () => {
    const rows: CcSwitchDbRow[] = [
      // app_type=codex 但 settingsConfig 无 OPENAI 键(纯 base_url)→ 直读 codex
      { id: "1", name: "n1", settingsConfig: JSON.stringify({ base_url: "https://x" }), appType: "codex" },
      // app_type=claude 且带 ANTHROPIC 键 → 直读 claude
      { id: "2", name: "n2", settingsConfig: JSON.stringify({ env: { ANTHROPIC_API_KEY: "k" } }), appType: "claude" },
      // app_type=grokbuild → tmd 未接,启发式也不认 → 跳过
      { id: "3", name: "n3", settingsConfig: JSON.stringify({ env: { XAI_API_KEY: "k" } }), appType: "grokbuild" },
    ];
    const m = parseCcSwitchDbRows(rows);
    expect(m.get("codex")?.length).toBe(1);
    expect(m.get("claude")?.length).toBe(1);
    expect(m.get("codex")?.[0].id).toBe("1");
    expect(m.get("claude")?.[0].id).toBe("2");
  });

  it("坏 settingsConfig 行跳过", () => {
    const rows: CcSwitchDbRow[] = [
      { id: "1", name: "n1", settingsConfig: "not json" },
      { id: "2", name: "n2", settingsConfig: JSON.stringify({ env: { OPENAI_API_KEY: "k" } }) },
    ];
    const m = parseCcSwitchDbRows(rows);
    expect(m.get("codex")?.length).toBe(1);
  });

  it("空 id 跳过", () => {
    const m = parseCcSwitchDbRows([
      { id: "", name: "n", settingsConfig: JSON.stringify({ env: { OPENAI_API_KEY: "k" } }) },
    ]);
    expect(m.size).toBe(0);
  });
});

describe("normalizeProvider", () => {
  it("claude:env 三键摊平,带 source/ccsId", () => {
    const ch = normalizeProvider("claude", {
      id: "p1",
      name: "p1",
      settingsConfig: {
        env: {
          ANTHROPIC_BASE_URL: "https://anthropic.example.com",
          ANTHROPIC_AUTH_TOKEN: "tk",
          ANTHROPIC_MODEL: "claude-x",
        },
      },
    }, 100);
    expect(ch.id).toBe("ccs_claude_p1");
    expect(ch.baseUrl).toBe("https://anthropic.example.com");
    expect(ch.apiKey).toBe("tk");
    expect(ch.model).toBe("claude-x");
    expect(ch.source).toBe("cc-switch");
    expect(ch.ccsId).toBe("p1");
    expect(ch.createdAt).toBe(100);
  });

  it("codex:env.OPENAI_API_KEY / base_url / model", () => {
    const ch = normalizeProvider("codex", {
      id: "p2",
      name: "p2",
      settingsConfig: {
        env: { OPENAI_API_KEY: "ok" },
        base_url: "https://x.example.com",
        model: "gpt-5",
      },
    });
    expect(ch.baseUrl).toBe("https://x.example.com");
    expect(ch.apiKey).toBe("ok");
    expect(ch.model).toBe("gpt-5");
  });
});

describe("dedupeCcSwitchImport", () => {
  it("同 ccsId 更新字段", () => {
    const existing: Channel = {
      id: "ccs_claude_p1", name: "old", baseUrl: "https://old", source: "cc-switch", ccsId: "p1", createdAt: 1,
    };
    const incoming: Channel[] = [{
      id: "x", name: "new", baseUrl: "https://new", source: "cc-switch", ccsId: "p1", createdAt: 2,
    }];
    const r = dedupeCcSwitchImport(new Map([["p1", existing]]), incoming);
    expect(r.updated.length).toBe(1);
    expect(r.updated[0].id).toBe("ccs_claude_p1");
    expect(r.updated[0].baseUrl).toBe("https://new");
    expect(r.added.length).toBe(0);
  });

  it("新 ccsId 入 added", () => {
    const r = dedupeCcSwitchImport(new Map(), [{
      id: "x", name: "n", source: "cc-switch", ccsId: "p1", createdAt: 1,
    }]);
    expect(r.added.length).toBe(1);
  });

  it("无 ccsId 的入 skipped", () => {
    const r = dedupeCcSwitchImport(new Map(), [{ id: "x", name: "n", createdAt: 1 }]);
    expect(r.skipped.length).toBe(1);
  });
});
