/**
 * 证据分级模型场景矩阵(2026-09-11 重构;同日评审后守卫塌缩为「未应答写入
 * 天花板」:写入后 120s 内不结算未应答轮次,家具活性不再参与守卫)。
 * 旧契约(轮次开启闸/空闲重绘闸/思考期守卫 P0)钉在 activityWatch.test.ts。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityWatch } from "./activityWatch";
import { stripAnsi } from "./askDetect";

function makeWatch() {
  const viewing = new Set<string>();
  const watch = new ActivityWatch({
    isViewing: (id) => viewing.has(id),
    exists: () => true,
    noiseGated: () => true,
    onChange: () => undefined,
    onTurnSettled: () => undefined,
  });
  return { watch, viewing };
}

/* omp 实测形态:字母骨架恒定、数字每秒变动(elapsed 计数)= 活着的家具。 */
const tickFrame = (sec: number) => stripAnsi(`\u001b[1;1H ⠙ ${sec}s · 模型 GLM`);

/* 字母与数字都恒定(版本号类)= 死的家具。 */
const STATIC_FURNITURE = stripAnsi("\u001b[1;1H ⠹ tmd v1.2.3 · 就绪");

/* omp 空闲页脚实测帧:字母骨架恒定(提交重绘首帧即 content,复现即 static)。 */
const IDLE_VISIBLE = stripAnsi("\u001b[1;1H ⠙ 9s · 模型 GLM");

describe("证据分级模型", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("tick 家具持轮:elapsed 每秒变动时不结算;停跳后由未应答天花板兜底(omp 工具执行期)", () => {
    const { watch } = makeWatch();
    watch.onUserWrite("s");
    watch.onOutput("s", "question echoed"); // 回显:开轮,但不算应答证据
    for (let sec = 9; sec <= 39; sec++) {
      watch.onOutput("s", tickFrame(sec));
      vi.advanceTimersByTime(1000);
      expect(watch.isTurnActive("s")).toBe(true);
    }
    vi.advanceTimersByTime(5000); // 计数停跳 + 静默超阈:未应答守卫仍扣住
    expect(watch.isTurnActive("s")).toBe(true);
    vi.advanceTimersByTime(120_000); // 写入 +120s 天花板:必结算,不永挂
    expect(watch.isTurnActive("s")).toBe(false);
  });

  it("取舍钉板:awaiting 期异步噪音内容置 answered 拆掉守卫,思考期遭遇噪音即提前结算(08 §6)", () => {
    const { watch } = makeWatch();
    watch.onUserWrite("s");
    watch.onOutput("s", IDLE_VISIBLE); // 提交重绘同批:开轮(spinner 首帧)
    vi.advanceTimersByTime(500);
    for (let i = 0; i < 10; i++) {
      watch.onOutput("s", IDLE_VISIBLE); // 思考期 spinner 自绘
      vi.advanceTimersByTime(100);
    }
    watch.onOutput("s", "hook: build finished"); // 异步噪音:回显窗外新骨架 → answered
    vi.advanceTimersByTime(3000);
    expect(watch.isTurnActive("s")).toBe(false); // 守卫被拆;真应答晚到会被闸 3 拦(不自愈)
  });

  it("静态家具不持轮:版本号类恒定自绘吊不住已应答轮次的结算", () => {
    const { watch } = makeWatch();
    watch.onUserWrite("s");
    vi.advanceTimersByTime(500);
    watch.onOutput("s", "question echoed"); // 回显窗外:应答证据
    for (let i = 0; i < 100; i++) {
      watch.onOutput("s", STATIC_FURNITURE);
      vi.advanceTimersByTime(100);
    }
    expect(watch.isTurnActive("s")).toBe(false); // 静态家具不进证据钟,2s 即静默
  });

  it("空轮宽限:无任何家具的 CLI 思考期不假结算、不吞 awaiting(盲区回归)", () => {
    const { watch } = makeWatch();
    watch.onUserWrite("s");
    watch.onOutput("s", "inputbox redraw"); // 回显窗内内容:开轮,不算应答
    vi.advanceTimersByTime(30_000); // 零家具静默(旧实现 2s 即假结算吞 awaiting)
    expect(watch.isTurnActive("s")).toBe(true);
    watch.onOutput("s", "real answer body"); // 真实应答照常入轮
    vi.advanceTimersByTime(3000);
    expect(watch.isTurnActive("s")).toBe(false);
  });

  it("ssh/shell 快命令:回显窗内完结不被宽限扣住,2s 照常结算(豁免会话不守卫)", () => {
    const viewing = new Set<string>();
    const watch = new ActivityWatch({
      isViewing: (id) => viewing.has(id),
      exists: () => true,
      noiseGated: () => false, // ssh/shell:输出即活动,不参与分类与守卫
      onChange: () => undefined,
      onTurnSettled: () => undefined,
    });
    watch.onUserWrite("sh");
    watch.onOutput("sh", "file-a\nfile-b"); // 输出全部落在回显窗内:answered 仍 false
    vi.advanceTimersByTime(3000);
    expect(watch.isTurnActive("sh")).toBe(false); // 旧宽限若不限定 gated 会扣 120s
  });

  it("宽限上限:无家具轮次写入 120s 后照常结算,不永挂运行时", () => {
    const { watch, viewing } = makeWatch();
    watch.onUserWrite("s");
    watch.onOutput("s", "inputbox redraw");
    vi.advanceTimersByTime(121_000);
    expect(watch.isTurnActive("s")).toBe(false);
    viewing.delete("s"); // 未在查看 → 标未读
    expect(watch.isUnread("s")).toBe(true);
  });

  it("墙钟空闲页脚:settled 后 tick 分片不重跑生命周期(闸只认用户因果)", () => {
    const { watch, viewing } = makeWatch();
    viewing.add("s");
    watch.onUserWrite("s");
    vi.advanceTimersByTime(500); // 真实 TTFB:应答首帧恒晚于回显窗
    watch.onOutput("s", "question echoed");
    watch.onOutput("s", "answer body");
    vi.advanceTimersByTime(3000);
    expect(watch.isTurnActive("s")).toBe(false);
    for (let sec = 60; sec <= 130; sec++) {
      watch.onOutput("s", tickFrame(sec)); // 空闲墙钟每秒跳
      vi.advanceTimersByTime(1000);
    }
    expect(watch.isTurnActive("s")).toBe(false);
    expect(watch.isUnread("s")).toBe(false); // 已查看态保持,不被重跑
  });

  it("中轮全静默 ceiling:应答后零家具静默 >2s 照常结算(与真结束字节不可分,既定边界)", () => {
    const { watch } = makeWatch();
    watch.onUserWrite("s");
    vi.advanceTimersByTime(500); // 真实 TTFB:应答首帧恒晚于回显窗
    watch.onOutput("s", "answer body");
    vi.advanceTimersByTime(3000);
    expect(watch.isTurnActive("s")).toBe(false);
  });
});
