/**
 * session-relay 纯逻辑契约测试:目标枚举排除当前、摘要拼装(最近 N 条截取/
 * 无消息占位/标题与模型行/单条与总长截断双闸)。
 */
import { describe, expect, it } from "vitest";
import {
  buildRelaySummary,
  relayTargets,
  SUMMARY_ITEM_MAX_CHARS,
  SUMMARY_PROMPT_LIMIT,
  SUMMARY_TOTAL_MAX_BYTES,
} from "./relay";

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
    const built = buildRelaySummary(
      { profileId: "omp", engineName: "omp", cliSessionId: "x", title: "改审批线", model: "glm-5.3" },
      prompts,
    );
    expect(built.truncated).toBe(false);
    expect(built.text).toContain("接力自 omp 会话「改审批线」(模型 glm-5.3)");
    expect(built.text).toContain(`1. 任务${14 - SUMMARY_PROMPT_LIMIT + 1}`); // 截掉最早 4 条
    expect(built.text).toContain("10. 任务14");
    expect(built.text).not.toContain("任务1\n");
    expect(built.text).toContain("不要重复已完成");
  });

  it("无消息时给诚实占位,不虚构历史", () => {
    const built = buildRelaySummary({ profileId: "omp", engineName: "omp" }, []);
    expect(built.text).toContain("未提取到历史输入");
    expect(built.text).toContain("全新开始");
    expect(built.truncated).toBe(false);
  });

  it("无标题时省略书名号段", () => {
    const built = buildRelaySummary({ profileId: "omp", engineName: "omp" }, [msg("做点事")]);
    expect(built.text.startsWith("接力自 omp 会话。")).toBe(true);
  });

  it("单条超 500 字截断尾部并标记", () => {
    const long = "甲".repeat(SUMMARY_ITEM_MAX_CHARS + 200);
    const built = buildRelaySummary({ profileId: "omp", engineName: "omp" }, [msg(long), msg("收尾")]);
    expect(built.truncated).toBe(true);
    expect(built.text).toContain(`1. ${"甲".repeat(SUMMARY_ITEM_MAX_CHARS)}…`);
    expect(built.text).not.toContain("甲".repeat(SUMMARY_ITEM_MAX_CHARS + 1));
    expect(built.text).toContain("2. 收尾");
  });

  it("单条截断不劈开代理对(emoji 截点回退,不产孤立代理)", () => {
    /* 1 个 BMP 字 + N 个 emoji(各 2 码元):截点必落在某个代理对中间。 */
    const emoji = "字" + "😀".repeat(SUMMARY_ITEM_MAX_CHARS);
    const built = buildRelaySummary({ profileId: "omp", engineName: "omp" }, [msg(emoji), msg("收尾")]);
    expect(built.truncated).toBe(true);
    expect(built.text).toContain(`1. 字${"😀".repeat(Math.floor((SUMMARY_ITEM_MAX_CHARS - 1) / 2))}…`);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(built.text)).toBe(false);
  });

  it("总长超 8KB(UTF-8 字节)从最旧条目起丢弃,最新一条恒保", () => {
    /* 每条 480 个汉字(单条不触发 500 字闸),UTF-8 下 ≈1.4KB/条;
       最近 10 条 ≈14KB > 8KB → 总长闸丢最旧,最新条(19 号)恒在。 */
    const prompts = Array.from({ length: 20 }, (_, i) => msg(`${String(i).padStart(2, "0")} ` + "乙".repeat(480)));
    const built = buildRelaySummary({ profileId: "omp", engineName: "omp" }, prompts);
    expect(built.truncated).toBe(true);
    /* 输出条目重编号 1..N:最新一条 = "10. 19 …",最旧一条("1. 10 …")被丢 */
    expect(built.text).toContain("10. 19 ");
    expect(built.text).not.toContain("1. 10 ");
    expect(new TextEncoder().encode(built.text).length).toBeLessThanOrEqual(SUMMARY_TOTAL_MAX_BYTES);
  });
});
