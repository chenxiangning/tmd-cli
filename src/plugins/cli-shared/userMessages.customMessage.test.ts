/**
 * omp/pi custom_message 用户轮次 —— 解析与判空回归(2026-09-30 审查会话实证)。
 *
 * skill 起步的会话磁盘上没有 role:"user" 行,用户输入记作
 * `{"type":"custom_message","customType":"skill-prompt","attribution":"user",
 * "details":{name,args,prompt}}`。判别字段照抄 omp 会话展示层:customType ∈
 * {skill-prompt, custom-message} 且 attribution === "user"(agent 注入的
 * mount-notice 是 display:false + attribution:agent)。缺这两处会让时间线空挂、
 * 会话清扫把 skill 起步的会话误判空而物理删除。
 *
 * 直测 userMessages.parseUserMessages(行预筛+解析)与 sessionEmpty.isJsonlSessionEmpty
 * (标记子串);piFamily 的文件定位/读窗装配已由 piFamily.test.ts 覆盖。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fsReadHead: vi.fn() }));
vi.mock("@kernel/ipc", () => ({ ipc: { fsReadHead: mocks.fsReadHead } }));

import { isJsonlSessionEmpty } from "./sessionEmpty";
import { isWrapperText, ompPiUserMessageLine, parseUserMessages } from "./userMessages";

const line = (o: object) => JSON.stringify(o);
const skillPrompt = (over: object = {}) => ({
  type: "custom_message", customType: "skill-prompt", id: "s1",
  attribution: "user", display: true,
  details: { name: "ponytail-review", path: "/x/SKILL.md", args: "审查 0.2.5 以来变更" },
  ...over,
});

beforeEach(() => vi.resetAllMocks());

describe("ompPiUserMessageLine custom_message 轮次", () => {
  it("skill-prompt/custom-message(attribution:user)入列,文本合成同 omp 展示层", () => {
    const msgs = parseUserMessages([
      line(skillPrompt()),
      line({ type: "message", id: "m1", message: { role: "assistant" } }),
      line({
        type: "custom_message", customType: "custom-message", id: "s2",
        attribution: "user", display: true, content: "自定义输入",
        details: { prompt: "自定义 prompt 正文" },
      }),
    ].join("\n"), ompPiUserMessageLine);
    expect(msgs).toEqual([
      { id: "s1", text: "/skill:ponytail-review 审查 0.2.5 以来变更" },
      { id: "s2", text: "自定义 prompt 正文" },
    ]);
  });

  it("agent 注入(display:false / attribution:agent)与无名 details 跳过", () => {
    const msgs = parseUserMessages([
      line(skillPrompt({ attribution: "agent", display: false, content: "<system-notice>x</system-notice>" })),
      line({ type: "custom_message", customType: "xdev-mount-notice", id: "s3", attribution: "agent", display: false }),
      line(skillPrompt({ id: "s4", details: {} })),
    ].join("\n"), ompPiUserMessageLine);
    expect(msgs).toEqual([]);
  });

  it("details.prompt 优先于 args;isWrapperText 仍生效", () => {
    expect(parseUserMessages(line(skillPrompt({
      details: { prompt: "正文", args: "参数" },
    })), ompPiUserMessageLine)).toEqual([{ id: "s1", text: "正文" }]);
    expect(isWrapperText("<system-notice>x")).toBe(true);
  });
});

describe("isJsonlSessionEmpty skill 标记(清扫防误删)", () => {
  it("skill-prompt 头 → 非空;纯出生文件 → 空;读失败 → 判不了(false)", async () => {
    mocks.fsReadHead.mockResolvedValueOnce(`${line(skillPrompt())}\n`);
    await expect(isJsonlSessionEmpty("/s/skill.jsonl")).resolves.toBe(false);
    mocks.fsReadHead.mockResolvedValueOnce(line({ type: "custom", customType: "session" }));
    await expect(isJsonlSessionEmpty("/s/birth.jsonl")).resolves.toBe(true);
    mocks.fsReadHead.mockRejectedValueOnce(new Error("ENOENT"));
    await expect(isJsonlSessionEmpty("/s/gone.jsonl")).resolves.toBe(false);
  });
});
