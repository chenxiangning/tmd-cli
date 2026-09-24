import { describe, expect, it } from "vitest";
import { parseTranscript, tailTurns } from "./transcript";

/* 夹具 = 真实抓包行(2026-09-23 本机 ~/.pi/agent/sessions、~/.claude/projects 抽样,
 * 字段级保真;仅缩短文本) */
const PI_USER =
  '{"type":"message","id":"13e39d3a","parentId":"daf5f61d","timestamp":"2026-09-11T10:28:20.217Z","message":{"role":"user","content":[{"type":"text","text":"你好"}],"timestamp":1789122500106}}';
const PI_THINK =
  '{"type":"message","message":{"role":"assistant","content":[{"type":"thinking","thinking":"内心戏"},{"type":"text","text":"回答正文"}]}}';
const CLAUDE_USER =
  '{"type":"user","message":{"role":"user","content":"项目分析"},"uuid":"c03f"}';
const CLAUDE_TOOLUSE =
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"先读文件"},{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"/a/b.ts","limit":5}}]}}';
const CODEX_MSG =
  '{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"codex 正文"}]}}';
const CODEX_CALL =
  '{"type":"response_item","payload":{"type":"function_call","name":"shell","arguments":"{\\"cmd\\":\\"ls\\"}"}}';

describe("transcript 解析(线上形状)", () => {
  it("omp/pi:message 行 → 文本 turns;thinking 跳过", () => {
    const turns = parseTranscript(`${PI_USER}\n${PI_THINK}`);
    expect(turns).toEqual([
      { role: "user", text: "你好" },
      { role: "assistant", text: "回答正文" },
    ]);
  });

  it("claude:content 字符串与 parts 双形态;tool_use 单独成操作 turn", () => {
    const turns = parseTranscript(`${CLAUDE_USER}\n${CLAUDE_TOOLUSE}`);
    expect(turns).toEqual([
      { role: "user", text: "项目分析" },
      { role: "assistant", text: "先读文件" },
      { role: "tool", tool: "Read", text: "/a/b.ts" },
    ]);
  });

  it("codex:response_item 载体(message + function_call)", () => {
    const turns = parseTranscript(`${CODEX_MSG}\n${CODEX_CALL}`);
    expect(turns[0]).toEqual({ role: "assistant", text: "codex 正文" });
    expect(turns[1]).toMatchObject({ role: "tool", tool: "shell" });
  });

  it("残行/元数据行/非 JSON 安全跳过;超长文本截断", () => {
    const garbage = '{"type":"model_change","modelId":"gpt-5.5"';
    const long = JSON.stringify({
      type: "message",
      message: { role: "user", content: "字".repeat(900) },
    });
    const turns = parseTranscript([garbage, long].join("\n"));
    expect(turns).toHaveLength(1);
    expect(turns[0].text.length).toBeLessThan(620);
  });

  it("tailTurns 取尾部窗口", () => {
    const turns = parseTranscript([PI_USER, PI_THINK, CLAUDE_USER].join("\n"));
    expect(tailTurns(turns, 2)).toHaveLength(2);
    expect(tailTurns(turns, 2)[0].text).toBe("回答正文");
  });

});
