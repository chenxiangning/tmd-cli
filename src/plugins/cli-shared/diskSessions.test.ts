/**
 * extractJsonlTitle 标题提取契约测试(四种 CLI 行型实证样本)。
 * 显示优先级:omp title 记录 > session 行 title > claude summary > 首条用户消息。
 */

import { describe, expect, it } from "vitest";
import { extractJsonlTitle } from "./diskSessions";

describe("extractJsonlTitle", () => {
  it("omp:title 记录(首行,带空格风格)直接定案", () => {
    const head = [
      '{"type": "title", "v": 1, "title": "Design session list breathing light rules", "source": "auto", "pad": "  "}',
      '{"type": "session", "version": 3, "id": "x", "title": "不应被采用"}',
      '{"type":"message","message":{"role":"user","content":[{"type":"text","text":"也不应被采用"}]}}',
    ].join("\n");
    expect(extractJsonlTitle(head)).toBe(
      "Design session list breathing light rules",
    );
  });

  it("omp:title 记录(紧凑风格)同样识别", () => {
    const head = '{"type":"title","v":1,"title":"Explain cd not changing prompt","source":"auto"}';
    expect(extractJsonlTitle(head)).toBe("Explain cd not changing prompt");
  });

  it("pi:无 title 记录时取 session 行内 title 字段", () => {
    const head = [
      '{"type":"session","version":3,"id":"u","timestamp":"t","cwd":"/p","title":"可以聊。不过我这边不能直接访问"}',
      '{"type":"model_change","id":"m"}',
    ].join("\n");
    expect(extractJsonlTitle(head)).toBe("可以聊。不过我这边不能直接访问");
  });

  it("claude:summary 行优先于首条用户消息", () => {
    const head = [
      '{"type":"mode","mode":"normal","sessionId":"s"}',
      '{"type":"summary","summary":"修复登录页样式回归","leafUuid":"l"}',
      '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"原始问题"}]}}',
    ].join("\n");
    expect(extractJsonlTitle(head)).toBe("修复登录页样式回归");
  });

  it("claude:无 summary 时取首条 user 消息(数组 content)", () => {
    const head = [
      '{"type":"file-history-snapshot","messageId":"m","snapshot":{}}',
      '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"帮我看看这个报错"}]}}',
    ].join("\n");
    expect(extractJsonlTitle(head)).toBe("帮我看看这个报错");
  });

  it("claude:user 消息为字符串 content 也识别;assistant 消息不抢位", () => {
    const head = [
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"我先说"}]}}',
      '{"type":"user","message":{"role":"user","content":"字符串形式的提问"}}',
    ].join("\n");
    expect(extractJsonlTitle(head)).toBe("字符串形式的提问");
  });

  it("codex:response_item 首条 role:user 的 input_text", () => {
    const head = [
      '{"timestamp":"t","type":"session_meta","payload":{"id":"u","cwd":"/p"}}',
      '{"type":"response_item","payload":{"type":"message","role":"developer","content":[{"type":"input_text","text":"系统指令不应入选"}]}}',
      '{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"codex 帮我重构这个函数"}]}}',
    ].join("\n");
    expect(extractJsonlTitle(head)).toBe("codex 帮我重构这个函数");
  });
  it("codex:AGENTS.md 指令包装消息跳过,取后续真实用户输入(实证)", () => {
    const head = [
      '{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"# AGENTS.md instructions for /Users/x/proj\\n\\n<INSTRUCTIONS>规则全文</INSTRUCTIONS>"}]}}',
      '{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"真实问题"}]}}',
    ].join("\n");
    expect(extractJsonlTitle(head)).toBe("真实问题");
  });

  it("omp/pi:message 行 role:user 兜底", () => {
    const head = [
      '{"type":"session","version":3,"id":"u","timestamp":"t","cwd":"/p"}',
      '{"type":"message","id":"a","message":{"role":"user","content":[{"type":"text","text":"第一条用户消息"}]}}',
      '{"type":"message","id":"b","message":{"role":"user","content":[{"type":"text","text":"第二条不应覆盖"}]}}',
    ].join("\n");
    expect(extractJsonlTitle(head)).toBe("第一条用户消息");
  });

  it("XML 包装文本(<command-…/<system-reminder>…)不作为标题", () => {
    const head =
      '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"<system-reminder>注入内容</system-reminder>"}]}}';
    expect(extractJsonlTitle(head)).toBeUndefined();
  });

  it("tool_result 等异型 content 不产生标题", () => {
    const head =
      '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"out"}]}}';
    expect(extractJsonlTitle(head)).toBeUndefined();
  });

  it("长标题折叠空白并截断到 60 字符补省略号", () => {
    const long = "甲".repeat(80);
    // JSON 字符串内为转义 \n,parse 解码后由 normalizeTitle 折叠
    const head = `{"type":"summary","summary":"多行\\n\\n   ${long}"}`;
    const title = extractJsonlTitle(head);
    expect(title).toBe(`多行 ${"甲".repeat(80)}`.slice(0, 60) + "…");
    expect(title).toHaveLength(61);
  });

  it("head 截断末行(JSON 不完整)跳过不炸,其余行照常", () => {
    const head = [
      '{"type":"session","version":3,"id":"u","title":"完好标题"',
      '{"type":"summary","summary":"截断前的 summary"}',
    ].join("\n");
    expect(extractJsonlTitle(head)).toBe("截断前的 summary");
  });

  it("全无可识别内容返回 undefined(UI 回退短码)", () => {
    expect(extractJsonlTitle('{"type":"mode","mode":"normal"}')).toBeUndefined();
    expect(extractJsonlTitle("")).toBeUndefined();
  });
});
