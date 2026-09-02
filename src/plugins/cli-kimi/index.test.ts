/**
 * cli-kimi 插件纯函数测试:wire 行解析、标题提取与 config.toml 状态解析。
 * fixture 形状实证自本机 ~/.kimi/sessions/ 与 ~/.kimi/config.toml(kimi 0.34.0)。
 */
import { describe, expect, it } from "vitest";
import {
  extractKimiTitle,
  kimiUserMessageLine,
  normalizeKimiTitle,
  parseKimiConfigStatus,
} from "./index";

/** 本机 wire.jsonl 真实行型(2026-09-02 实证)。 */
const turnBegin = (text: string, ts = 1769513122.2860181) =>
  JSON.stringify({
    timestamp: ts,
    message: { type: "TurnBegin", payload: { user_input: [{ type: "text", text }] } },
  });

describe("kimiUserMessageLine", () => {
  it("TurnBegin 行 → 用户消息,id 取事件时间戳", () => {
    expect(kimiUserMessageLine(JSON.parse(turnBegin("你好")))).toEqual({
      id: "t1769513122.2860181",
      text: "你好",
    });
  });

  it("metadata 与 StatusUpdate 等非 TurnBegin 行返回 null", () => {
    expect(
      kimiUserMessageLine(JSON.parse('{"type":"metadata","protocol_version":"1.1"}')),
    ).toBeNull();
    expect(
      kimiUserMessageLine(
        JSON.parse(
          '{"timestamp":1784507961.98,"message":{"type":"StatusUpdate","payload":{"context_usage":0.05}}}',
        ),
      ),
    ).toBeNull();
  });

  it("user_input 非文本段(图片等)被跳过,全非文本返回 null", () => {
    const line = JSON.stringify({
      timestamp: 1,
      message: {
        type: "TurnBegin",
        payload: { user_input: [{ type: "image", url: "file:///x.png" }] },
      },
    });
    expect(kimiUserMessageLine(JSON.parse(line))).toBeNull();
  });

  it("多文本段拼接为一条消息", () => {
    const line = JSON.stringify({
      timestamp: 2,
      message: {
        type: "TurnBegin",
        payload: {
          user_input: [
            { type: "text", text: "看下" },
            { type: "text", text: "这个文件" },
          ],
        },
      },
    });
    expect(kimiUserMessageLine(JSON.parse(line))?.text).toBe("看下\n这个文件");
  });
});

describe("extractKimiTitle", () => {
  it("首条 TurnBegin 用户输入即标题,折叠空白", () => {
    const head = [
      '{"type":"metadata","protocol_version":"1.1"}',
      turnBegin("  是否正常\n登录成功  "),
    ].join("\n");
    expect(extractKimiTitle(head)).toBe("是否正常 登录成功");
  });

  it("head 截断产生坏行时跳过,取后续完整行", () => {
    const head = `{"timestamp":1,"message":{"type":"TurnBeg\n${turnBegin("123")}`;
    expect(extractKimiTitle(head)).toBe("123");
  });

  it("无用户输入(纯 metadata)返回 undefined", () => {
    expect(extractKimiTitle('{"type":"metadata","protocol_version":"1.1"}')).toBeUndefined();
  });
});

describe("normalizeKimiTitle", () => {
  it("超长截断补省略号", () => {
    const long = "字".repeat(80);
    expect(normalizeKimiTitle(long)).toBe("字".repeat(59) + "…");
  });
});

describe("parseKimiConfigStatus", () => {
  it("实证 config.toml:default_model + default_thinking=true", () => {
    const toml = [
      'default_model = "kimi-code/kimi-for-coding"',
      "default_thinking = true",
      "",
      '[models."kimi-code/kimi-for-coding"]',
      'provider = "managed:kimi-code"',
    ].join("\n");
    expect(parseKimiConfigStatus(toml)).toEqual({
      model: "kimi-code/kimi-for-coding",
      thinkingLevel: "on",
    });
  });

  it("default_thinking=false 映射为 off", () => {
    expect(
      parseKimiConfigStatus('default_model = "m"\ndefault_thinking = false'),
    ).toEqual({ model: "m", thinkingLevel: "off" });
  });

  it("只有 thinking 键也算有效观测;两键全缺返回 null", () => {
    expect(parseKimiConfigStatus("default_thinking = true")).toEqual({
      thinkingLevel: "on",
    });
    expect(parseKimiConfigStatus('[loop_control]\nmax_steps = 1')).toBeNull();
  });
});
