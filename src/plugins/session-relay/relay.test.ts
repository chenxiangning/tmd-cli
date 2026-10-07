/**
 * session-relay 纯逻辑契约测试:目标枚举排除当前、角色化摘要拼装(三角色在场/
 * reasoning 丢弃/无内容占位/标题与模型行/会话预算截断+末条助手结论保底/
 * 源转录截断标记传递)。
 */
import { describe, expect, it } from "vitest";
import { buildRelaySummary, relayTargets, RELAY_DIGEST_CAPS, appendCarriedMarks } from "./relay";
import { dshTranscriptLine } from "../cli-dsh/dshTranscript";
import type { CliTranscriptBlock, CliTranscriptToolMeta } from "@kernel/cli";

const PROFILES = [
  { id: "omp", name: "omp" },
  { id: "pi", name: "pi" },
  { id: "codex", name: "codex" },
] as never[];

const block = (
  role: CliTranscriptBlock["role"],
  text: string,
  tool?: CliTranscriptToolMeta,
): CliTranscriptBlock => ({ id: Math.random().toString(36).slice(2), role, text, ...(tool ? { tool } : {}) });

describe("relayTargets", () => {
  it("排除当前引擎,保持注册顺序", () => {
    const ids = relayTargets(PROFILES, "pi").map((p) => p.id);
    expect(ids).toEqual(["omp", "codex"]);
  });
});

describe("buildRelaySummary", () => {
  it("三角色在场:用户/助手/工具各成行,含来源标题与模型", () => {
    const blocks = [
      block("user", "帮我改审批线的封口时机"),
      block("reasoning", "思考过程不该进接力摘要"),
      block("assistant", "定位到 activityWatch 三钟出窗判据,建议 TURN_SILENCE_MS 提到 2s"),
      block("tool", "编辑 src/kernel/activityWatch.ts", { title: "编辑 activityWatch.ts", status: "ok" }),
    ];
    const built = buildRelaySummary(
      { profileId: "omp", engineName: "omp", cliSessionId: "x", title: "改审批线", model: "glm-5.3" },
      blocks,
    );
    expect(built.truncated).toBe(false);
    expect(built.text).toContain("接力自 omp 会话「改审批线」(模型 glm-5.3)");
    expect(built.text).toContain("用户:帮我改审批线的封口时机");
    expect(built.text).toContain("助手:定位到 activityWatch 三钟出窗判据");
    expect(built.text).toContain("动作:编辑 activityWatch.ts");
    expect(built.text).not.toContain("思考过程");
    expect(built.text).toContain("不要重复已完成");
  });

  it("无内容块(读取失败/全 reasoning)给诚实占位,不虚构历史", () => {
    for (const blocks of [null, [block("reasoning", "纯思考")]] as const) {
      const built = buildRelaySummary({ profileId: "omp", engineName: "omp" }, blocks);
      expect(built.text).toContain("未提取到历史输入");
      expect(built.text).toContain("全新开始");
      expect(built.truncated).toBe(false);
    }
  });

  it("无标题时省略书名号段", () => {
    const built = buildRelaySummary({ profileId: "omp", engineName: "omp" }, [block("user", "做点事")]);
    expect(built.text.startsWith("接力自 omp 会话。")).toBe(true);
  });

  it("超会话预算截断标记 + 末条助手结论保底(收尾结论在场)", () => {
    /* 每条用户行 500+ 字(单行不触 user 1200 闸),累计必破 6000 会话闸;
       末条助手结论在切断点之后,靠保底行进摘要。 */
    const blocks = [
      ...Array.from({ length: 12 }, (_, i) => block("user", `阶段${i} ` + "甲".repeat(500))),
      block("assistant", "最终结论:封口时机改为三钟全出窗,已补集成测试"),
    ];
    const built = buildRelaySummary({ profileId: "omp", engineName: "omp" }, blocks);
    expect(built.truncated).toBe(true);
    expect(built.text).toContain("(摘录超预算,后续内容省略)");
    expect(built.text).toContain("助手(结尾):最终结论:封口时机改为三钟全出窗");
    /* 头尾行与角色行都在场;预算行数有限,文本远小于全量转录 */
    expect(built.text.length).toBeLessThan(RELAY_DIGEST_CAPS.session + 2000);
  });

  it("源转录超读取预算(32MB 截断)时 truncated 透传", () => {
    const built = buildRelaySummary(
      { profileId: "omp", engineName: "omp" },
      [block("user", "一句话")],
      true,
    );
    expect(built.truncated).toBe(true);
  });

  it("双旗叠加:源读取截断 + 摘录超预算同真,标记与结论保底共存不互斥", () => {
    const blocks = [
      ...Array.from({ length: 12 }, (_, i) => block("user", `阶段${i} ` + "甲".repeat(500))),
      block("assistant", "最终结论:双旗叠加路径已核"),
    ];
    const built = buildRelaySummary({ profileId: "omp", engineName: "omp" }, blocks, true);
    expect(built.truncated).toBe(true);
    expect(built.text).toContain("(摘录超预算,后续内容省略)");
    expect(built.text).toContain("助手(结尾):最终结论:双旗叠加路径已核");
  });
});

describe("dsh 作接力源(契约:真实事件流过 parser → 摘要有角色行,非占位)", () => {
  it("dshTranscriptLine 实产块喂 buildRelaySummary,用户/助手行在场", () => {
    /* W1 换源前 dsh 无 readSessionUserMessages → 摘要恒「未提取到历史输入」;
       换 readSessionTranscript 后 dsh 事件流即真实源,此 fixture 钉死该路径。 */
    const blocks = [
      ...dshTranscriptLine({
        type: "user/message",
        seq: 1,
        time: 1787648514901,
        data: { content: [{ type: "text", text: "把审批策略改成三钟全出窗" }], source: { kind: "user" }, role: "user", id: "u1" },
      }),
      ...dshTranscriptLine({
        type: "assistant/message",
        seq: 2,
        time: 1787648515000,
        data: { message: { role: "assistant", content: [{ type: "text", text: "已改完,封口时机迁移到三钟全出窗" }] } },
      }),
    ];
    const built = buildRelaySummary({ profileId: "dsh", engineName: "dsh" }, blocks);
    expect(built.text).toContain("用户:把审批策略改成三钟全出窗");
    expect(built.text).toContain("助手:已改完,封口时机迁移到三钟全出窗");
    expect(built.truncated).toBe(false);
  });
});

describe("appendCarriedMarks", () => {
  it("无携带原样返回;携带时引用块按 composer 同模板附尾", () => {
    const mark = {
      path: "src/kernel/store.ts",
      startLine: 63,
      endLine: 104,
      note: "sidecar 真相源",
      excerpt: "const ledgerPath",
    };
    expect(appendCarriedMarks("摘要正文", [])).toBe("摘要正文");
    const two = { path: "src/b.ts", startLine: 41, endLine: 51, note: "状态机", excerpt: "flip()" };
    const out = appendCarriedMarks("摘要正文", [mark, two]);
    expect(out.startsWith("摘要正文\n\n")).toBe(true);
    expect(out).toContain("请看我在文件里标记的 2 处:");
    expect(out).toContain("src/kernel/store.ts:L63-L104\n  > const ledgerPath\n  标注:sidecar 真相源\n\nsrc/b.ts:L41-L51");
  });
});
