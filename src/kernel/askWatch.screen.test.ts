/**
 * AskWatch 屏幕态通道测试(onScreenSample,幕布 1Hz 采样)——
 * 自 askWatch.test.ts 拆出(文件规模铁则收紧至 300 行)。
 * 覆盖:连续在场防抖置位、作答清屏幕态与写后抑制窗、字节流置位被屏幕消失自愈、
 * hasState 回放补观察短路判据。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AskWatch } from "./askWatch";

/** omp Ask 面板样例(带 ANSI 样式,取自真实输出形态)。 */
const OMP_ASK =
  "\x1b[1mAsk 1 questions\x1b[0m\r\n\x1b[2m[plan_confirm] · options:3\x1b[0m";

/** 推过确认窗(1.2s)再触发输出评估的便捷步进。 */
async function pastConfirm() {
  await vi.advanceTimersByTimeAsync(1_300);
}

/** 测试用 CLI 声明标记(omp/pi-tui 卡片字面量;生产由 AskWatchFeed 经
    CliProfile.askMarks 注入,内核通用正则只留 y/n 与 Do you want)。 */
const TEST_ASK_MARKS: RegExp[] = [
  /Ask \d+ questions?/,
  /Enter select\b/,
  /Esc(?: to)? cancel\b/,
  /Other \(type your own\)/,
];

/** 带声明标记的馈送(每 describe 的 beforeEach 绑定当次 watch 实例)。 */
let fire: (id: string, text: string) => boolean;
describe("屏幕态通道(onScreenSample,幕布 1Hz 采样)", () => {
  let watch: AskWatch;

  beforeEach(() => {
    vi.useFakeTimers();
    watch = new AskWatch();
    fire = (id, text) => watch.onOutput(id, text, text.length, TEST_ASK_MARKS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("标记连续在场 ≥1.2s 才置位(防抖),消失即摘", async () => {
    expect(watch.onScreenSample("sc1", true)).toBeNull(); // 记起算
    expect(watch.isWaiting("sc1")).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(watch.onScreenSample("sc1", true)).toBeNull(); // 1.0s 未满窗
    await vi.advanceTimersByTimeAsync(400);
    expect(watch.onScreenSample("sc1", true)).toBe("asked"); // 1.4s 置位
    expect(watch.isWaiting("sc1")).toBe(true);
    expect(watch.onScreenSample("sc1", true)).toBeNull(); // 已置位不重复边沿
    expect(watch.onScreenSample("sc1", false)).toBe("healed"); // 面板消失 → 摘
    expect(watch.isWaiting("sc1")).toBe(false);
  });

  it("作答(write)清屏幕态;抑制窗内屏幕残影不复燃,窗后仍在场才升级", async () => {
    watch.onScreenSample("sc2", true);
    await vi.advanceTimersByTimeAsync(1_300);
    watch.onScreenSample("sc2", true);
    expect(watch.isWaiting("sc2")).toBe(true);
    expect(watch.onUserWrite("sc2")).toBe(true); // 作答即摘
    expect(watch.isWaiting("sc2")).toBe(false);
    /* 残影仍在屏幕:抑制窗内采样不记起算 */
    expect(watch.onScreenSample("sc2", true)).toBeNull();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(watch.onScreenSample("sc2", true)).toBeNull(); // 仍在 8s 抑制窗
    await vi.advanceTimersByTimeAsync(4_500);
    expect(watch.onScreenSample("sc2", true)).toBeNull(); // 窗过,记起算
    await vi.advanceTimersByTimeAsync(1_300);
    expect(watch.onScreenSample("sc2", true)).toBe("asked"); // 连续多问延迟亮标
  });

  it("字节流置位的等待被屏幕消失自愈(CLI 自行继续,spinner 使流静默永不达成)", async () => {
    fire("sc3", OMP_ASK);
    await pastConfirm();
    fire("sc3", OMP_ASK);
    expect(watch.isWaiting("sc3")).toBe(true);
    expect(watch.onScreenSample("sc3", false)).toBe("healed"); // 屏幕无面板 → 摘
    expect(watch.isWaiting("sc3")).toBe(false);
  });

  it("hasState:等待/候选存在为 true,回放补观察短路判据", async () => {
    expect(watch.hasState("sc4")).toBe(false);
    fire("sc4", OMP_ASK); // 立候选
    expect(watch.hasState("sc4")).toBe(true);
    await pastConfirm();
    fire("sc4", OMP_ASK); // 升级等待
    expect(watch.hasState("sc4")).toBe(true);
    watch.onUserWrite("sc4");
    expect(watch.hasState("sc4")).toBe(false);
  });
});
