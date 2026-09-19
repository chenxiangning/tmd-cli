/**
 * AskWatchCore 核心状态机补充契约测试 —— 直测 askWatchCore.ts(外层行为已由
 * askWatch.test.ts / askWatch.screen.test.ts 覆盖,此处只补两文件的空白):
 * 1. 私有标记注入面:首帧 extraMarks 跨帧留存(feed 只随首帧注入);未注入会话
 *    吃不到 CLI 私有字面量(内核不理解私有格式铁则);会话移除连标记一并清除。
 * 2. 字节计量:缺口/漂移按传入 byteLength(UTF-8 字节)计量,CJK 大帧按字符数
 *    的默认值会偏松;byteLength=0 的大文本不构成缺口。
 * 3. 守望计时器:无检测态停表不空转;屏幕置位的等待不被字节自愈摘除(3h 挂起
 *    面板回归);屏幕等待期字节复现不重复发边沿。
 * 4. 回调与多会话:onHealed 自愈回调恰一次且不牵连字面量仍在的会话;多会话
 *    同 tick 静默确认互不串扰、onAsked 恰一次。
 * 5. 写入闸与复位:候选观察期/屏幕起算期写入同为「作答」上写后闸;resetForTest
 *    连写后闸时刻一并归零。
 * 6. 页脚窗口 5 行边界:倒数第 5 行命中、倒数第 6 行脱窗。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AskWatch } from "./askWatchCore";

/** omp Ask 面板样例(带 ANSI,取自真实输出形态;通用正则不命中,须靠私有标记)。 */
const OMP_ASK =
  "\x1b[1mAsk 1 questions\x1b[0m\r\n\x1b[2m[plan_confirm] · options:3\x1b[0m";

/** 测试用 CLI 声明标记(生产由 AskWatchFeed 经 CliProfile.askMarks 注入)。 */
const TEST_ASK_MARKS: RegExp[] = [/Ask \d+ questions?/];

/** 推过确认窗(1.2s)的便捷步进。 */
async function pastConfirm() {
  await vi.advanceTimersByTimeAsync(1_300);
}

describe("私有标记注入面(extraMarks)", () => {
  let watch: AskWatch;
  beforeEach(() => {
    vi.useFakeTimers();
    watch = new AskWatch();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("首帧注入的私有标记跨帧留存:后续帧不带 extraMarks 仍可确认升级", async () => {
    /* 生产形态:feed 只随首帧输出注入 askMarks,后续帧不再携带 */
    expect(watch.onOutput("m1", OMP_ASK, OMP_ASK.length, TEST_ASK_MARKS)).toBe(false);
    await pastConfirm();
    expect(watch.onOutput("m1", OMP_ASK)).toBe(true); // 复现命中靠留存标记
    expect(watch.isWaiting("m1")).toBe(true);
  });

  it("未注入私有标记的会话:私有字面量不误报(内核不理解 CLI 私有格式)", async () => {
    expect(watch.onOutput("m2", OMP_ASK)).toBe(false);
    await pastConfirm(); // 若误立候选,静默确认会在此升级
    expect(watch.isWaiting("m2")).toBe(false);
    expect(watch.hasState("m2")).toBe(false);
  });

  it("会话移除连声明标记一并清除:重建后旧私有标记不再命中", async () => {
    watch.onOutput("m3", OMP_ASK, OMP_ASK.length, TEST_ASK_MARKS);
    watch.onSessionRemoved("m3");
    expect(watch.onOutput("m3", OMP_ASK)).toBe(false); // 标记已清,不命中
    await pastConfirm(); // 若标记残留,此处会静默确认升级
    expect(watch.isWaiting("m3")).toBe(false);
  });
});

describe("字节计量(byteLength 语义)", () => {
  let watch: AskWatch;
  beforeEach(() => {
    vi.useFakeTimers();
    watch = new AskWatch();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("CJK 大帧按 UTF-8 字节计量撤销候选;按字符数默认值则容忍并静默确认", async () => {
    const cjk = "汉".repeat(6_000); // UTF-8 18KB,字符数仅 6k
    expect(new TextEncoder().encode(cjk).length).toBe(18_000);
    watch.onOutput("b1", OMP_ASK, OMP_ASK.length, TEST_ASK_MARKS); // 立候选
    watch.onOutput("b1", cjk, 18_000); // 按字节:缺口 18KB > 16KB → 撤销
    await vi.advanceTimersByTimeAsync(2_500); // 无候选可静默确认
    expect(watch.isWaiting("b1")).toBe(false);
    watch.onOutput("b2", OMP_ASK, OMP_ASK.length, TEST_ASK_MARKS); // 立候选
    watch.onOutput("b2", cjk); // 默认 byteLength=text.length=6000:缺口未超限
    await vi.advanceTimersByTimeAsync(2_500); // 期满静默确认(1.2s 窗 + tick 网格)
    expect(watch.isWaiting("b2")).toBe(true); // 候选保留,静默确认升级
  });

  it("缺口按传入 byteLength 计量而非文本长度:byteLength=0 的大文本不撤销候选", async () => {
    watch.onOutput("b3", OMP_ASK, OMP_ASK.length, TEST_ASK_MARKS);
    watch.onOutput("b3", "r".repeat(17_000), 0); // 字节增量为 0,缺口为零
    await vi.advanceTimersByTimeAsync(2_500); // 期满静默确认
    expect(watch.isWaiting("b3")).toBe(true); // 若按 text.length 计早已撤销
  });
});

describe("守望计时器(1Hz 懒计时器)", () => {
  let watch: AskWatch;
  beforeEach(() => {
    vi.useFakeTimers();
    watch = new AskWatch();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("无检测态停表不空转:候选撤销/等待自愈后计时器归零", async () => {
    watch.onOutput("t1", OMP_ASK, OMP_ASK.length, TEST_ASK_MARKS); // 立候选
    expect(vi.getTimerCount()).toBe(1);
    watch.onOutput("t1", "r".repeat(17_000)); // 缺口超限撤销
    await vi.advanceTimersByTimeAsync(1_100); // 下个 tick 清点后停表
    expect(vi.getTimerCount()).toBe(0);
    watch.onOutput("t1", OMP_ASK, OMP_ASK.length, TEST_ASK_MARKS); // 重新立候选
    await pastConfirm();
    expect(watch.onOutput("t1", OMP_ASK)).toBe(true); // 复现升级
    /* 响应流 6 行把面板推出页脚窗口;静默 2s 后自愈,同 tick 停表 */
    watch.onOutput(
      "t1",
      "auto-continued\r\nfull response\r\nstreams many\r\nlines onward\r\npast the panel\r\nend",
    );
    await vi.advanceTimersByTimeAsync(4_000);
    expect(watch.isWaiting("t1")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("屏幕置位的等待不被字节自愈摘除:静默远超阈值仍保留(3h 挂起面板回归)", async () => {
    expect(watch.onScreenSample("t2", true)).toBeNull(); // 记起算
    await vi.advanceTimersByTimeAsync(1_300);
    expect(watch.onScreenSample("t2", true)).toBe("asked");
    expect(vi.getTimerCount()).toBe(1); // 屏幕等待保持计时器(自愈互认需要)
    await vi.advanceTimersByTimeAsync(12_000); // 无任何字节输出,静默远超 2s
    expect(watch.isWaiting("t2")).toBe(true); // 字节自愈只作用于字节流等待
    expect(watch.onScreenSample("t2", false)).toBe("healed"); // 消失即摘
    expect(watch.isWaiting("t2")).toBe(false);
  });

  it("屏幕等待期字节流复现不重复发边沿(双通道互认)", async () => {
    const asked: string[] = [];
    const w = new AskWatch(undefined, (id) => asked.push(id));
    w.onScreenSample("t3", true);
    await vi.advanceTimersByTimeAsync(1_300);
    expect(w.onScreenSample("t3", true)).toBe("asked");
    expect(w.onOutput("t3", OMP_ASK, OMP_ASK.length, TEST_ASK_MARKS)).toBe(false);
    expect(w.isWaiting("t3")).toBe(true);
    expect(asked).toEqual([]); // 屏幕升级不经 onAsked;字节复现也不重复上报
  });
});

describe("回调与多会话隔离", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("onHealed:静默自愈以会话 id 恰回调一次;尾巴有字面量的会话不受牵连", async () => {
    const healed: string[] = [];
    const w = new AskWatch((id) => healed.push(id));
    for (const id of ["h1", "h2"]) {
      w.onOutput(id, OMP_ASK, OMP_ASK.length, TEST_ASK_MARKS); // 双双立候选
    }
    await pastConfirm();
    for (const id of ["h1", "h2"]) {
      w.onOutput(id, OMP_ASK); // 复现升级
    }
    /* h1 响应流把面板推出页脚窗口;h2 尾巴仍守字面量 */
    w.onOutput("h1", "auto\r\ncontinued\r\nfull response\r\nstreams on\r\npast panel\r\ndone");
    await vi.advanceTimersByTimeAsync(4_000);
    expect(healed).toEqual(["h1"]);
    expect(w.isWaiting("h1")).toBe(false);
    expect(w.isWaiting("h2")).toBe(true);
  });

  it("多会话并发:同 tick 静默确认互不串扰,onAsked 按会话各恰一次", async () => {
    const asked: string[] = [];
    const w = new AskWatch(undefined, (id) => asked.push(id));
    w.onOutput("p1", OMP_ASK, OMP_ASK.length, TEST_ASK_MARKS);
    w.onOutput("p2", OMP_ASK, OMP_ASK.length, TEST_ASK_MARKS);
    expect(w.hasState("p1")).toBe(true);
    expect(w.hasState("p2")).toBe(true);
    await vi.advanceTimersByTimeAsync(2_500); // 无复现:双双静默确认
    expect(asked).toEqual(["p1", "p2"]);
    expect(w.isWaiting("p1")).toBe(true);
    expect(w.isWaiting("p2")).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000); // 尾巴字面量仍在:自愈不误清
    expect(asked).toEqual(["p1", "p2"]); // 恰一次,不重复
  });
});

describe("写入闸与复位", () => {
  let watch: AskWatch;
  beforeEach(() => {
    vi.useFakeTimers();
    watch = new AskWatch();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("候选观察期写入同为作答:上写后闸,残影过确认窗也不升级", async () => {
    watch.onOutput("w1", OMP_ASK, OMP_ASK.length, TEST_ASK_MARKS); // 立候选
    expect(watch.onUserWrite("w1")).toBe(false); // 候选期无等待态可翻
    /* 写入清候选+尾巴;残影重现立新候选,抑制窗内复现过窗不升级 */
    expect(watch.onOutput("w1", OMP_ASK, OMP_ASK.length, TEST_ASK_MARKS)).toBe(false);
    await pastConfirm();
    expect(watch.onOutput("w1", OMP_ASK)).toBe(false); // 距写入 1.3s < 8s
    await vi.advanceTimersByTimeAsync(7_500); // 跨过 8s 闸
    expect(watch.isWaiting("w1")).toBe(true); // 抑制窗只延迟不吞掉
  });

  it("屏幕起算观察期写入同样上闸:抑制窗内连续在场不置位", async () => {
    expect(watch.onScreenSample("w2", true)).toBeNull(); // 记起算(未置位)
    expect(watch.onUserWrite("w2")).toBe(false); // 观察期写入:无等待可翻
    await vi.advanceTimersByTimeAsync(100);
    expect(watch.onScreenSample("w2", true)).toBeNull(); // 窗内不记起算
    await vi.advanceTimersByTimeAsync(1_500);
    expect(watch.onScreenSample("w2", true)).toBeNull(); // 起算未累计:不到防抖窗
    await vi.advanceTimersByTimeAsync(8_000); // 跨过写后闸
    expect(watch.onScreenSample("w2", true)).toBeNull(); // 重新记起算
    await vi.advanceTimersByTimeAsync(1_300);
    expect(watch.onScreenSample("w2", true)).toBe("asked");
  });

  it("resetForTest 连写后闸时刻一并归零:清态后新提问立即正常确认", async () => {
    watch.onOutput("w3", OMP_ASK, OMP_ASK.length, TEST_ASK_MARKS);
    await pastConfirm();
    watch.onOutput("w3", OMP_ASK); // 升级等待
    watch.onUserWrite("w3"); // 真作答:上 8s 闸
    await vi.advanceTimersByTimeAsync(1_000);
    watch.resetForTest(); // 闸时刻一并清零(同 id 复用 + 时钟回拨会变永久闸)
    watch.onOutput("w3", OMP_ASK, OMP_ASK.length, TEST_ASK_MARKS); // 立候选
    await pastConfirm();
    expect(watch.onOutput("w3", OMP_ASK)).toBe(true); // 距原写入仅 ~2.3s,未受闸
    expect(watch.isWaiting("w3")).toBe(true);
  });
});

describe("页脚窗口边界(末 5 行)", () => {
  it("标记在倒数第 5 行仍命中立候选;滚到倒数第 6 行脱窗不命中", () => {
    const w = new AskWatch();
    /* 5 行整:标记在第 1 行 = 倒数第 5 行,页脚窗口恰好罩住 */
    w.onOutput("f1", "Proceed with edit? (y/n)\nl2\nl3\nl4\nl5");
    expect(w.hasState("f1")).toBe(true);
    /* 6 行:标记被推到倒数第 6 行,脱窗 */
    w.onOutput("f2", "Proceed with edit? (y/n)\nl2\nl3\nl4\nl5\nl6");
    expect(w.hasState("f2")).toBe(false);
  });
});
