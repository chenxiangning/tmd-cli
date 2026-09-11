/**
 * 轮次开启闸单元测试(2026-09-08)—— 直接构造 ActivityWatch 钉谓词矩阵;
 * host 级集成路径(真 sessionTabs 接线)见 host.unread.test.ts。
 *
 * 契约:tab 已关且无未应答写入的已了结 CLI 会话,新输出(异步噪音)不开轮;
 * ssh/shell「输出即活动」语义豁免闸门 —— 远端长任务(make 静默数分钟后
 * 输出完工)关 tab 后必须照常开轮、结算标未读。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityWatch } from "./activityWatch";
import { stripAnsi } from "./askDetect";

function makeWatch(opts: { gated?: boolean } = {}) {
  const openTabs = new Set<string>();
  const viewing = new Set<string>();
  const watch = new ActivityWatch({
    isViewing: (id) => viewing.has(id),
    exists: () => true,
    hasOpenTab: (id) => openTabs.has(id),
    noiseGated: () => opts.gated ?? true,
    onChange: () => undefined,
    onTurnSettled: () => undefined,
  });
  return { watch, openTabs, viewing };
}

describe("轮次开启闸", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("关 tab 的已了结会话:噪音不开轮、不推进活动钟、不标未读", () => {
    const { watch, openTabs, viewing } = makeWatch();
    openTabs.add("s");
    viewing.add("s");
    watch.onUserWrite("s");
    watch.onOutput("s");
    vi.advanceTimersByTime(3000); // 结算:正在查看 → 已查看
    const settledAt = watch.lastActivityAt("s");

    openTabs.delete("s"); // 关 tab(会话保持运行)
    viewing.delete("s");
    expect(watch.onOutput("s")).toBe(false); // 异步噪音被闸挡
    vi.advanceTimersByTime(3000);
    expect(watch.isTurnActive("s")).toBe(false);
    expect(watch.lastActivityAt("s")).toBe(settledAt);
    expect(watch.isUnread("s")).toBe(false);
  });

  it("ssh/shell 豁免:关 tab 后长任务完工输出照常开轮、结算标未读", () => {
    const { watch, openTabs, viewing } = makeWatch({ gated: false });
    openTabs.add("sh");
    viewing.add("sh");
    watch.onUserWrite("sh"); // make\r
    watch.onOutput("sh"); // 初期输出,用户在看
    vi.advanceTimersByTime(3000); // viewed 结算

    openTabs.delete("sh"); // 关 tab
    viewing.delete("sh");
    watch.onOutput("sh"); // 编译静默后输出完工(豁免闸门)
    expect(watch.isTurnActive("sh")).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(watch.isUnread("sh")).toBe(true); // 完工通知不丢
  });
});

/* 真实 omp 空闲帧(取自 ~/.tmd-cli/session/omp/… 日志尾部原样字节):OSC 标题
   重写 + 光标寻址原地重绘首行。剥 ANSI 后骨架恒为「与TOD」(braille spinner
   glyph 属符号类,不计入骨架)。 */
const IDLE_FRAME =
  "\u001b[0m\u001b[K\u001b[3;4H\u001b[?25h\u001b[?7h\u001b[?25l\u001b[?7l" +
  "\u001b]0;⠹ Fix ask detection in background sessions\u0007" +
  "\u001b[1;1H\u001b[0m\u001b[K ⠹ · 与…  TOD\u001b[3;4H";
const IDLE_VISIBLE = stripAnsi(IDLE_FRAME);

describe("空闲重绘闸", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("OSC 标题整段剥离(残渣会污染骨架判据)", () => {
    expect(IDLE_VISIBLE).not.toContain("Fix ask detection");
  });

  it("spinner 原地自绘:复现骨架不推活动钟,轮次照常结算", () => {
    const { watch, openTabs, viewing } = makeWatch();
    openTabs.add("s");
    viewing.add("s");
    watch.onUserWrite("s");
    expect(watch.onOutput("s", "answer body")).toBe(true); // 内容分片:开轮回绿
    const answeredAt = watch.lastActivityAt("s");

    // 回答结束,只剩 spinner 自绘(10Hz × 20s,远超 2s 静默阈值)
    for (let i = 0; i < 200; i++) {
      expect(watch.onOutput("s", IDLE_VISIBLE)).toBe(false);
      vi.advanceTimersByTime(100);
    }
    expect(watch.isTurnActive("s")).toBe(false); // 已结算,不被自绘重开
    expect(watch.lastActivityAt("s")).toBe(answeredAt); // 活动钟停在最后内容帧
  });

  it("纯控制序列分片(骨架为空)不算活动", () => {
    const { watch, openTabs } = makeWatch();
    openTabs.add("s");
    watch.onUserWrite("s");
    watch.onOutput("s", "answer body");
    vi.advanceTimersByTime(3000);
    expect(watch.onOutput("s", stripAnsi("\u001b[3;4H\u001b[?25h \u00b7\u2026"))).toBe(false);
    expect(watch.isTurnActive("s")).toBe(false);
  });

  it("空闲期真实新输出(新骨架)照常开轮、未查看标未读", () => {
    const { watch, openTabs, viewing } = makeWatch();
    openTabs.add("s");
    viewing.add("s");
    watch.onUserWrite("s");
    watch.onOutput("s", "answer body");
    vi.advanceTimersByTime(100);
    watch.onOutput("s", IDLE_VISIBLE); // 首见骨架:入窗放行
    watch.onOutput("s", IDLE_VISIBLE); // 复现:被闸
    vi.advanceTimersByTime(3000); // viewed 结算
    expect(watch.isTurnActive("s")).toBe(false);

    viewing.delete("s"); // 用户切走
    watch.onOutput("s", IDLE_VISIBLE); // 自绘:不重开轮
    expect(watch.isTurnActive("s")).toBe(false);
    watch.onOutput("s", "next turn output"); // 真输出:重开轮
    expect(watch.isTurnActive("s")).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(watch.isUnread("s")).toBe(true);
  });

  it("用户新提问清骨架窗:跨轮次逐字符全等的输出不被误判重绘", () => {
    const { watch, openTabs } = makeWatch();
    openTabs.add("s");
    watch.onUserWrite("s");
    watch.onOutput("s", "yes");
    vi.advanceTimersByTime(3000);
    watch.onUserWrite("s"); // 又一轮短答
    expect(watch.onOutput("s", "yes")).toBe(true);
  });

  it("ssh/shell 豁免:重复骨架仍算活动(输出即活动语义)", () => {
    const { watch, openTabs } = makeWatch({ gated: false });
    openTabs.add("sh");
    watch.onUserWrite("sh");
    expect(watch.onOutput("sh", "done")).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(watch.onOutput("sh", "done")).toBe(true);
    expect(watch.isTurnActive("sh")).toBe(true);
  });

  it("省略可见文本 = 不参与重绘判定(既有直调方语义不变)", () => {
    const { watch, openTabs } = makeWatch();
    openTabs.add("s");
    watch.onUserWrite("s");
    expect(watch.onOutput("s")).toBe(true);
  });
});
