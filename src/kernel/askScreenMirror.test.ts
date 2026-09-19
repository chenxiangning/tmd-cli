/**
 * 屏幕态镜像(askScreenMirror)采样器核心单测 —— 后台会话的 headless xterm
 * 1Hz 采样器。与 askScreenMirror.host.test.ts 互补:该件经 host 全链验证接线,
 * 本件直驱 AskScreenMirror,验证采样器自身契约。
 *
 * 契约清单:
 * 1. feed 懒建镜像:首字节即养 Terminal,首发采样在满 1s tick
 * 2. 持续再置位:静态屏幕每个 tick 都照发,不因已报告停发(host 的防抖置位、
 *    写后抑制窗后的再升级都依赖连续在场采样)
 * 3. 屏幕尾窗口:只采 buffer 底部 8 行(与 TerminalView askProbe 逐字符同式:
 *    每行去尾空白 + "\n"),滚出窗口的历史行不进样
 * 4. 自愈语义:面板被后续整帧覆盖/滚出屏后,采样随新现势失标 —— 等待态摘除
 *    由 host 屏幕通道按采样内容判定,镜像只负责如实上报
 * 5. 幕布互斥:getTerminalHandle 在册会话跳过采样(让位真实幕布),注销后镜像
 *    接管;多会话互不串样
 * 6. 整帧幂等:光标寻址重绘下,分片入站/同帧重放屏幕态不变(屏面是现势不是
 *    日志,重复与乱序到帧不叠影)
 * 7. backfill:空串不建镜像不启表;非空等同 feed(readopt 磁盘尾补底同路)
 * 8. remove:镜像消亡不再采样;末镜像移除后计时器停摆(泄漏会致每 tick 翻倍);
 *    未知 id no-op;同 id 重建得全新空屏,旧面板不复活
 * 9. resetForTest:全态归零,归零后可复用
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalHandle } from "./terminalHandles";
import { registerTerminalHandle, unregisterTerminalHandle } from "./terminalHandles";
import { AskScreenMirror } from "./askScreenMirror";

/** 纯文本直排:逐行 \r\n 连接,自然滚动(无寻址)。 */
const plain = (...rows: string[]) => rows.join("\r\n");

/** 光标寻址整帧(omp 形态最小仿真):逐行绝对定位 + 行清除,重绘覆盖旧态。 */
const addressedFrame = (...rows: string[]) =>
  rows.map((t, i) => `\u001b[${i + 1};1H\u001b[2K${t}`).join("");

/** omp 面板帧形态:transcript 铺满 + 面板标记在尾部、状态栏垫底(24 行恰好满屏)。 */
const PANEL_ROWS = [
  ...Array.from({ length: 19 }, (_, i) => `transcript ${i}`),
  "╭─── ? Ask ─────────────────────────────────╮",
  "│  ◉ 活幕布真并排(推荐)",
  "│  ○ tab 轮播 + 汇总面板",
  "│  ○ Other (type your own)",
  "╰───────────────────────────────────────────╯",
];

/** 底部 8 行期望值:与幕布 askProbe 同式(每行去尾空白 + "\n")。 */
const tail8 = (rows: string[]) => rows.slice(-8).map((r) => r + "\n").join("");

describe("屏幕态镜像采样器核心(askScreenMirror)", () => {
  let mirror: AskScreenMirror;
  let samples: Array<[string, string]>;

  const sampleIds = () => samples.map((s) => s[0]).sort();
  const lastText = () => samples[samples.length - 1]![1];

  beforeEach(() => {
    vi.useFakeTimers();
    samples = [];
    mirror = new AskScreenMirror((id, text) => samples.push([id, text]));
  });
  afterEach(() => {
    mirror.resetForTest();
    vi.useRealTimers();
  });

  it("feed 懒建镜像:首字节即养 Terminal,首发采样在满 1s tick", async () => {
    mirror.feed("s1", plain(...PANEL_ROWS));
    expect(samples).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sampleIds()).toEqual(["s1"]);
  });

  it("持续再置位:静态屏幕每个 tick 都照发,不因已报告停发", async () => {
    mirror.feed("s1", plain(...PANEL_ROWS));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(sampleIds()).toEqual(["s1", "s1", "s1"]); /* host 防抖/再升级依赖连续在场 */
    expect(lastText()).toBe(tail8(PANEL_ROWS));
  });

  it("屏幕尾窗口:只采底部 8 行,滚出窗口的历史行不进样", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    mirror.feed("s1", plain(...rows));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(lastText()).toBe(tail8(rows)); /* 恰为 line 22..29 */
    expect(lastText()).not.toContain("line 21"); /* 窗口外第一行不漏进 */
    expect(lastText().split("\n")).toHaveLength(9); /* 8 行 + 收尾换行 */
  });

  it("自愈:面板被后续整帧覆盖,采样随新现势失标", async () => {
    mirror.feed("s1", addressedFrame(...PANEL_ROWS));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(lastText()).toContain("Other (type your own)");
    /* CLI 自行继续:整帧重绘推进屏幕,面板滚出 —— 等待态消失必须可观测 */
    const out = Array.from({ length: 30 }, (_, i) => `out ${i}`);
    mirror.feed("s1", plain(...out));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(lastText()).not.toContain("Ask");
    expect(lastText()).toBe(tail8(out));
  });

  it("幕布互斥:在册会话让位真实采样,注销后镜像接管;未在册会话不受牵连", async () => {
    const handle = {} as TerminalHandle; /* 镜像只看在册与否,不调成员 */
    registerTerminalHandle("s1", handle);
    mirror.feed("s1", plain(...PANEL_ROWS));
    mirror.feed("s2", plain(...PANEL_ROWS));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sampleIds()).toEqual(["s2", "s2"]); /* s1 在册跳过,s2 照发 */
    unregisterTerminalHandle("s1", handle);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sampleIds()).toEqual(["s1", "s2", "s2", "s2"]); /* s1 接管(含此前 s2 两发) */
    expect(lastText()).toBe(tail8(PANEL_ROWS)); /* 接管首发即现势 */
  });

  it("整帧幂等:分片入站与同帧重放屏幕态不变", async () => {
    const f = addressedFrame(...PANEL_ROWS);
    mirror.feed("s1", f.slice(0, 40)); /* PTY chunk 粒度任意,转义序列跨片不断 */
    mirror.feed("s1", f.slice(40));
    mirror.feed("s1", f); /* 整帧重放(重复事件) */
    await vi.advanceTimersByTimeAsync(1_000);
    expect(lastText()).toBe(tail8(PANEL_ROWS));
    expect(lastText().split("Other (type your own)")).toHaveLength(2); /* 不叠影不重复 */
  });

  it("乱序整帧:末写帧覆盖先到态,屏面是现势不是日志", async () => {
    const aRows = Array.from({ length: 24 }, (_, i) => `A ${i}`);
    const bRows = Array.from({ length: 24 }, (_, i) => `B ${i}`);
    mirror.feed("s1", addressedFrame(...aRows));
    mirror.feed("s1", addressedFrame(...bRows));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(lastText()).toBe(tail8(bRows));
    mirror.feed("s2", addressedFrame(...bRows));
    mirror.feed("s2", addressedFrame(...aRows)); /* 反序到达,末写帧同样胜出 */
    await vi.advanceTimersByTimeAsync(1_000);
    const s2Text = samples.find((s) => s[0] === "s2")![1];
    expect(s2Text).toBe(tail8(aRows));
    expect(s2Text).not.toContain("B 23"); /* 先到帧无残影 */
  });

  it("backfill:空串不建镜像不启表;非空等同 feed(磁盘尾补底)", async () => {
    mirror.backfill("s1", "");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(samples).toEqual([]); /* 无日志尾不养空镜像 */
    mirror.backfill("s2", plain(...PANEL_ROWS)); /* readopt 补底:重载前挂起面板直接可见 */
    await vi.advanceTimersByTimeAsync(1_000);
    expect(samples).toEqual([["s2", tail8(PANEL_ROWS)]]);
  });

  it("remove:镜像消亡不再采样;末镜像移除后计时器停摆;未知 id no-op", async () => {
    mirror.feed("s1", plain(...PANEL_ROWS));
    mirror.remove("nope"); /* 未知 id 不抛不扰 */
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sampleIds()).toEqual(["s1"]);
    mirror.remove("s1");
    samples = [];
    await vi.advanceTimersByTimeAsync(2_000);
    expect(samples).toEqual([]); /* 已删会话不复活 */
    /* 计时器停摆后再养镜像:每 tick 恰一发(stop/start 对称,泄漏的旧 interval 会翻倍) */
    mirror.feed("s2", plain(...PANEL_ROWS));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sampleIds()).toEqual(["s2", "s2"]);
  });

  it("remove 后同 id 重建:全新空屏,旧面板字节不复活", async () => {
    mirror.feed("s1", plain(...PANEL_ROWS));
    await vi.advanceTimersByTimeAsync(1_000);
    mirror.remove("s1");
    const idle = Array.from({ length: 24 }, (_, i) => `idle ${i}`);
    mirror.feed("s1", plain(...idle));
    await vi.advanceTimersByTimeAsync(1_000);
    const text = samples.find((s) => s[0] === "s1" && s[1].includes("idle 23"))![1];
    expect(text).toBe(tail8(idle));
    expect(text).not.toContain("Ask");
  });

  it("resetForTest:全态归零不再采样,归零后可复用", async () => {
    mirror.feed("s1", plain(...PANEL_ROWS));
    mirror.resetForTest();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(samples).toEqual([]);
    mirror.feed("s2", plain(...PANEL_ROWS)); /* 归零后计时器重启,镜像照常工作 */
    await vi.advanceTimersByTimeAsync(1_000);
    expect(samples).toEqual([["s2", tail8(PANEL_ROWS)]]);
  });
});
