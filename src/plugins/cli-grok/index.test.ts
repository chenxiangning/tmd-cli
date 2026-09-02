/**
 * cli-grok 插件纯函数测试:会话目录编码与 summary.json 解析。
 * fixture 形状实证自本机 ~/.grok/sessions/ 真实目录(grok 1.0.4)。
 */

import { describe, expect, it } from "vitest";
import { grokSessionsDirName, parseGrokSummary } from "./index";

describe("grokSessionsDirName", () => {
  it("实证:encodeURIComponent 全路径(/ → %2F)", () => {
    expect(grokSessionsDirName("/Users/x/code/AI/github/tmd-cli")).toBe(
      "%2FUsers%2Fx%2Fcode%2FAI%2Fgithub%2Ftmd-cli",
    );
  });

  it("实证:中文逐字符百分号编码(真实目录名)", () => {
    expect(grokSessionsDirName("/Users/x/code/内容分析")).toBe(
      "%2FUsers%2Fx%2Fcode%2F%E5%86%85%E5%AE%B9%E5%88%86%E6%9E%90",
    );
  });
});

describe("parseGrokSummary", () => {
  it("实证 summary.json:标题/模型/updated_at ms epoch", () => {
    const raw = JSON.stringify({
      info: {
        id: "ff2c4c1b-6c14-4896-95bd-ecef56386df4",
        cwd: "/Users/x/code/AI/github/codemoss",
      },
      session_summary: "User Checking If Assistant Is Available",
      created_at: "2026-08-19T04:48:07.862001Z",
      updated_at: "2026-08-19T04:50:03.069357Z",
      num_messages: 9,
      current_model_id: "grok-4.6",
      generated_title: "User Checking If Assistant Is Available",
    });
    expect(parseGrokSummary(raw)).toEqual({
      title: "User Checking If Assistant Is Available",
      model: "grok-4.6",
      updatedAt: Date.parse("2026-08-19T04:50:03.069357Z"),
    });
  });

  it("generated_title 缺失回退 session_summary;updated_at 缺失回退 last_active_at", () => {
    const raw = JSON.stringify({
      session_summary: "调试配额",
      last_active_at: "2026-08-19T04:50:03Z",
    });
    expect(parseGrokSummary(raw)).toEqual({
      title: "调试配额",
      model: undefined,
      updatedAt: Date.parse("2026-08-19T04:50:03Z"),
    });
  });

  it("坏 JSON / 非对象 / 空时间戳:分别返回 null / null / updatedAt undefined", () => {
    expect(parseGrokSummary("not json")).toBeNull();
    expect(parseGrokSummary("[1,2]")).toBeNull();
    expect(parseGrokSummary("{}")).toEqual({
      title: undefined,
      model: undefined,
      updatedAt: undefined,
    });
  });
});
