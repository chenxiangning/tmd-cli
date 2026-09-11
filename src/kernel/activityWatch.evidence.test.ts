/**
 * 证据分级模型场景矩阵(2026-09-11 重构)—— 三级分类(content / tick / static)、
 * 静默 = content+tick 证据钟、未应答写入守卫(spinner 活性 + 空轮宽限)。
 * 旧契约(轮次开启闸/空闲重绘闸/思考期守卫 P0/P1)钉在 activityWatch.test.ts,
 * 该文件零改动全绿是行为兼容的硬证据。
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

describe("证据分级模型", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("tick 家具持轮:elapsed 每秒变动时 30s 不结算,停跳后照常结算(omp 工具执行期)", () => {
    const { watch } = makeWatch();
    watch.onUserWrite("s");
    watch.onOutput("s", "question echoed"); // 回显:开轮
    for (let sec = 9; sec <= 39; sec++) {
      watch.onOutput("s", tickFrame(sec));
      vi.advanceTimersByTime(1000);
      expect(watch.isTurnActive("s")).toBe(true);
    }
    vi.advanceTimersByTime(3000); // 计数停跳 + 静默超阈
    expect(watch.isTurnActive("s")).toBe(false);
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
