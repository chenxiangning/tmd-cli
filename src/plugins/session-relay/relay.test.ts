/**
 * session-relay 纯逻辑契约测试:目标枚举排除当前、摘要拼装(最近 N 条截取/
 * 无消息占位/标题与模型行)。
 */
import { describe, expect, it } from "vitest";
import { buildRelaySummary, relayTargets, SUMMARY_PROMPT_LIMIT } from "./relay";

const PROFILES = [
  { id: "omp", name: "omp" },
  { id: "pi", name: "pi" },
  { id: "codex", name: "codex" },
] as never[];

const msg = (text: string) => ({ id: text, text });

describe("relayTargets", () => {
  it("排除当前引擎,保持注册顺序", () => {
    const ids = relayTargets(PROFILES, "pi").map((p) => p.id);
    expect(ids).toEqual(["omp", "codex"]);
  });
});

describe("buildRelaySummary", () => {
  it("取最近 N 条并编号,含来源标题与模型", () => {
    const prompts = Array.from({ length: 14 }, (_, i) => msg(`任务${i + 1}`));
    const text = buildRelaySummary(
      { profileId: "omp", engineName: "omp", cliSessionId: "x", title: "改审批线", model: "glm-5.3" },
      prompts,
    );
    expect(text).toContain("接力自 omp 会话「改审批线」(模型 glm-5.3)");
    expect(text).toContain(`1. 任务${14 - SUMMARY_PROMPT_LIMIT + 1}`); // 截掉最早 4 条
    expect(text).toContain("10. 任务14");
    expect(text).not.toContain("任务1\n");
    expect(text).toContain("不要重复已完成");
  });

  it("无消息时给诚实占位,不虚构历史", () => {
    const text = buildRelaySummary({ profileId: "omp", engineName: "omp" }, []);
    expect(text).toContain("未提取到历史输入");
    expect(text).toContain("全新开始");
  });

  it("无标题时省略书名号段", () => {
    const text = buildRelaySummary({ profileId: "omp", engineName: "omp" }, [msg("做点事")]);
    expect(text.startsWith("接力自 omp 会话。")).toBe(true);
  });
});
