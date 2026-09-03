/**
 * cli-kimi 插件纯函数测试:wire 行解析(双协议)、state.json 解析/标题、
 * 老 home wire 头标题提取与 config.toml 状态解析。
 * fixture 形状实证自本机 ~/.kimi-code(kimi-code 0.40.1)与 ~/.kimi(0.34.0)真实数据。
 */
import { describe, expect, it } from "vitest";
import {
  extractKimiTitle,
  kimiStateTitle,
  kimiUserMessageLine,
  matchKimiStatePath,
  normalizeKimiTitle,
  parseKimiConfigStatus,
  parseKimiState,
} from "./index";

/** 老 home(~/.kimi 1.1 协议)wire.jsonl 真实行型。 */
const turnBegin = (text: string, ts = 1769513122.2860181) =>
  JSON.stringify({
    timestamp: ts,
    message: { type: "TurnBegin", payload: { user_input: [{ type: "text", text }] } },
  });

/** 新 home(~/.kimi-code 1.4 协议)agents/main/wire.jsonl 真实行型。 */
const turnPrompt = (
  text: string,
  extra: Record<string, unknown> = {
    promptId: "msg_01M1HM4640Z5BG1XEKAM91F",
    time: 1788371380939,
  },
) =>
  JSON.stringify({
    type: "turn.prompt",
    agentId: "main",
    input: [{ type: "text", text }],
    origin: { kind: "user" },
    ...extra,
  });

describe("kimiUserMessageLine(1.4 turn.prompt)", () => {
  it("turn.prompt 行 → 用户消息,id 取 promptId", () => {
    expect(kimiUserMessageLine(JSON.parse(turnPrompt("你好")))).toEqual({
      id: "msg_01M1HM4640Z5BG1XEKAM91F",
      text: "你好",
    });
  });

  it("promptId 缺失时用 time(ms) 兜底;两者全缺返回 null", () => {
    expect(
      kimiUserMessageLine(JSON.parse(turnPrompt("在吗", { time: 1788371380939 }))),
    ).toEqual({ id: "t1788371380939", text: "在吗" });
    expect(kimiUserMessageLine(JSON.parse(turnPrompt("在吗", {})))).toBeNull();
  });

  it("origin.kind 非 user(注入/工具语义)返回 null", () => {
    const line = JSON.parse(turnPrompt("系统注入")) as Record<string, unknown>;
    line.origin = { kind: "tool" };
    expect(kimiUserMessageLine(line)).toBeNull();
  });

  it("input 非文本段(图片等)被跳过,全非文本返回 null", () => {
    const line = JSON.stringify({
      type: "turn.prompt",
      input: [{ type: "image", url: "file:///x.png" }],
      origin: { kind: "user" },
      promptId: "msg_x",
      time: 1,
    });
    expect(kimiUserMessageLine(JSON.parse(line))).toBeNull();
  });
});

describe("kimiUserMessageLine(1.1 TurnBegin,老 home)", () => {
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

describe("parseKimiState / kimiStateTitle(新 home state.json)", () => {
  it("v2 键型:cwd + title + lastPrompt", () => {
    const state = parseKimiState(
      JSON.stringify({
        id: "session_x",
        version: 2,
        cwd: "/w/demo",
        title: "创建一个 bbb.txt hello 写入",
        lastPrompt: "在吗",
        archived: false,
      }),
    );
    expect(state).toMatchObject({ cwd: "/w/demo", title: "创建一个 bbb.txt hello 写入" });
    expect(kimiStateTitle(state!)).toBe("创建一个 bbb.txt hello 写入");
  });

  it("v1 键型:workDir 兼容读取", () => {
    expect(
      parseKimiState(JSON.stringify({ workDir: "/w/old", title: "旧会话" }))?.cwd,
    ).toBe("/w/old");
  });

  it("占位标题 New Session 降级到 lastPrompt;全缺返回 undefined(UI 回退短码)", () => {
    expect(kimiStateTitle({ title: "New Session", lastPrompt: "写个\ncrud 示例" })).toBe(
      "写个 crud 示例",
    );
    expect(kimiStateTitle({ title: "New Session" })).toBeUndefined();
    expect(kimiStateTitle({})).toBeUndefined();
  });

  it("坏 JSON / 异型返回 null", () => {
    expect(parseKimiState("{oops")).toBeNull();
    expect(parseKimiState('{"cwd":42}')).not.toBeNull();
    expect(parseKimiState('{"cwd":42}')!.cwd).toBeUndefined();
  });
});

describe("matchKimiStatePath", () => {
  it("<桶>/<session_id>/state.json → id + 会话目录", () => {
    const m = matchKimiStatePath(
      "/home/x/.kimi-code/sessions/wd_demo_3b4360bbfae1/session_f8bbe370-0100-496a-9bdf-a0f7a6cfd7a4/state.json",
    );
    expect(m?.id).toBe("session_f8bbe370-0100-496a-9bdf-a0f7a6cfd7a4");
    expect(m?.dir).toBe(
      "/home/x/.kimi-code/sessions/wd_demo_3b4360bbfae1/session_f8bbe370-0100-496a-9bdf-a0f7a6cfd7a4",
    );
  });

  it("深层 json(subagent tasks)与 wire.jsonl 不匹配", () => {
    expect(
      matchKimiStatePath(
        "/h/.kimi-code/sessions/wd_a_0123456789ab/session_x/agents/agent-0/tasks/bash-1.json",
      ),
    ).toBeNull();
    expect(
      matchKimiStatePath("/h/.kimi/sessions/abc/session_x/wire.jsonl"),
    ).toBeNull();
  });
});

describe("extractKimiTitle(老 home wire 头)", () => {
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

  it("0.40 配置:只有 default_model(default_thinking 已弃用)→ thinkingLevel undefined", () => {
    expect(
      parseKimiConfigStatus('default_model = "kimi-code/kimi-for-coding-highspeed"'),
    ).toEqual({ model: "kimi-code/kimi-for-coding-highspeed", thinkingLevel: undefined });
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

  it("新键型实证:[thinking] 段 enabled+effort → effort 档位,优先于旧键", () => {
    const toml = [
      'default_model = "kimi-code/kimi-for-coding-highspeed"',
      "",
      "[thinking]",
      'enabled = true',
      'effort = "high"',
      "",
      "[loop_control]",
      "max_retries_per_step = 3",
    ].join("\n");
    expect(parseKimiConfigStatus(toml)).toEqual({
      model: "kimi-code/kimi-for-coding-highspeed",
      thinkingLevel: "high",
    });
  });

  it("[thinking] enabled=false → off,即使 effort 在场;段后跟其他 section 不误吞", () => {
    expect(
      parseKimiConfigStatus('[thinking]\nenabled = false\neffort = "high"\n\n[models."m"]'),
    ).toEqual({ thinkingLevel: "off" });
  });

  it("[thinking] 只有 effort 无 enabled → 取 effort", () => {
    expect(parseKimiConfigStatus('[thinking]\neffort = "medium"')).toEqual({
      thinkingLevel: "medium",
    });
  });
});
