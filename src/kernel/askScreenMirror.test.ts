/**
 * 屏幕态镜像(askScreenMirror)采样器核心单测 —— 后台会话的 headless xterm
 * 250ms 采样器。与 askScreenMirror.host.test.ts 互补:该件经 host 全链验证接线,
 * 本件直驱 AskScreenMirror,验证采样器自身契约。
 *
 * 契约清单:
 * 1. feed 懒建镜像:首字节即养 Terminal,首发采样在满 250ms tick
 * 2. 持续再置位:静态屏幕每个 tick 都照发,不因已报告停发(host 的防抖置位、
 *    写后抑制窗后的再升级都依赖连续在场采样)
 * 3. 全屏采样:scrollback=0 缓冲即物理屏,整屏照发;滚出屏的行不复活(无历史假阳性)
 * 4. 几何真源:默认 120×32(对齐 Rust spawn 默认);resize 中继先于首字节=懒建即用,
 *    已建=即时换栅格;querySize 拉取回包生效;中继与在途拉取竞态时中继胜(代数闸)
 * 5. backfill:空串不建镜像不启表;非空等几何就绪再回放;途中 remove 不写
 * 6. 自愈语义:面板被后续整帧覆盖/滚出屏后,采样随新现势失标 —— 等待态摘除
 *    由 host 屏幕通道按采样内容判定,镜像只负责如实上报
 * 7. 幕布互斥:getTerminalHandle 在册会话跳过采样(让位真实幕布),注销后镜像
 *    接管;多会话互不串样
 * 8. 整帧幂等:光标寻址重绘下,分片入站/同帧重放屏幕态不变(屏面是现势不是
 *    日志,重复与乱序到帧不叠影)
 * 9. remove:镜像消亡不再采样;末镜像移除后计时器停摆(泄漏会致每 tick 翻倍);
 *    未知 id no-op;同 id 重建得全新空屏,旧面板不复活
 * 10. resetForTest:全态归零,归零后可复用
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

/** omp 面板帧形态:面板标记在尾部(默认 120×32 栅格整屏可容)。 */
const PANEL_ROWS = [
  ...Array.from({ length: 19 }, (_, i) => `transcript ${i}`),
  "╭─── ? Ask ─────────────────────────────────╮",
  "│  ◉ 活幕布真并排(推荐)",
  "│  ○ tab 轮播 + 汇总面板",
  "│  ○ Other (type your own)",
  "╰───────────────────────────────────────────╯",
];

/** 全屏期望值:每行去尾空白 + "\n"(与 screenTextOf 同式)。 */
const screen = (rows: string[]) => rows.map((r) => r + "\n").join("");

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

  it("feed 懒建镜像:首字节即养 Terminal,首发采样在满 250ms tick", async () => {
    mirror.feed("s1", plain(...PANEL_ROWS));
    expect(samples).toEqual([]);
    await vi.advanceTimersByTimeAsync(250);
    expect(sampleIds()).toEqual(["s1"]);
  });

  it("持续再置位:静态屏幕每个 tick 都照发,不因已报告停发", async () => {
    mirror.feed("s1", plain(...PANEL_ROWS));
    await vi.advanceTimersByTimeAsync(750);
    expect(sampleIds()).toEqual(["s1", "s1", "s1"]); /* host 防抖/再升级依赖连续在场 */
    expect(lastText()).toBe(screen(PANEL_ROWS));
  });

  it("全屏采样:scrollback=0 缓冲即物理屏,滚出屏的行不复活", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    mirror.feed("s1", plain(...rows) + "\r\n"); /* 帧尾换行:防下次 feed 首行并入末行 */
    await vi.advanceTimersByTimeAsync(250);
    expect(lastText()).toBe(screen(rows)); /* 30 行整屏照发(默认 32 行栅格未满) */
    const more = Array.from({ length: 5 }, (_, i) => `more ${i}`);
    mirror.feed("s1", plain(...more));
    await vi.advanceTimersByTimeAsync(250);
    expect(lastText()).not.toContain("line 2\n"); /* 滚出屏 = 消失,无历史假阳性 */
    expect(lastText()).toContain("line 3\n");
    expect(lastText()).toContain("more 4");
  });

  it("几何真源:默认 120×32;resize 中继先于首字节=懒建即用", async () => {
    mirror.resize("s1", 200, 48); /* 幕布中继先到(挂过幕布的会话回后台) */
    const rows48 = Array.from({ length: 40 }, (_, i) => `tall ${i}`);
    mirror.feed("s1", plain(...rows48));
    await vi.advanceTimersByTimeAsync(250);
    expect(lastText()).toContain("tall 0"); /* 48 行栅格整屏可容(120×32 会滚掉 8 行) */
    const rows32 = Array.from({ length: 32 }, (_, i) => `def ${i}`);
    mirror.feed("s2", plain(...rows32));
    await vi.advanceTimersByTimeAsync(250);
    expect(samples.find((s) => s[0] === "s2")![1]).toContain("def 0"); /* 默认 120×32 */
  });

  it("几何真源:已建镜像的 resize 中继即时换栅格", async () => {
    const rows = Array.from({ length: 48 }, (_, i) => `r ${i}`);
    mirror.feed("s1", plain(...rows.slice(0, 10)));
    mirror.resize("s1", 200, 48); /* SIGWINCH:前台 fit 过,回后台 */
    mirror.feed("s1", plain(...rows)); /* 重绘帧按新栅格排布 */
    await vi.advanceTimersByTimeAsync(250);
    expect(lastText()).toContain("r 0"); /* 48 行全在屏(32 行栅格会滚掉 16 行) */
  });

  it("几何真源:querySize 拉取回包生效;在途拉取与中继竞态时中继胜", async () => {
    const pull = Promise.withResolvers<[number, number] | null>();
    const pulled = new AskScreenMirror((id, text) => samples.push([id, text]), () => pull.promise);
    pulled.feed("s1", plain("boot"));
    pulled.resize("s1", 200, 48); /* 中继在拉取回包前到达 */
    pull.resolve([80, 24]); /* 旧尺寸回包(拉取发起时的现势) */
    await vi.advanceTimersByTimeAsync(250);
    const rows48 = Array.from({ length: 40 }, (_, i) => `w ${i}`);
    pulled.feed("s1", plain(...rows48));
    await vi.advanceTimersByTimeAsync(250);
    const text = samples[samples.length - 1]![1];
    expect(text).toContain("w 0"); /* 中继的 48 行栅格胜出,旧回包不覆盖 */
    pulled.resetForTest();
  });

  it("几何真源:querySize 正常回包生效(webview 重载后唯一尺寸真源)", async () => {
    const pulled = new AskScreenMirror((id, text) => samples.push([id, text]), async () => [200, 48]);
    pulled.feed("s1", "boot");
    await vi.advanceTimersByTimeAsync(250); /* tick 顺带冲微任务,拉取定稿 */
    const rows48 = Array.from({ length: 40 }, (_, i) => `p ${i}`);
    pulled.feed("s1", plain(...rows48));
    await vi.advanceTimersByTimeAsync(250);
    expect(samples[samples.length - 1]![1]).toContain("p 0");
    pulled.resetForTest();
  });

  it("backfill:空串不建镜像不启表;非空等几何就绪再回放;途中移除不写", async () => {
    mirror.backfill("s0", "");
    await vi.advanceTimersByTimeAsync(500);
    expect(samples).toEqual([]); /* 无日志尾不养空镜像 */
    const gate = Promise.withResolvers<[number, number] | null>();
    const gated = new AskScreenMirror((id, text) => samples.push([id, text]), () => gate.promise);
    const pending = gated.backfill("s1", addressedFrame(...PANEL_ROWS));
    await vi.advanceTimersByTimeAsync(500);
    expect(lastText()).not.toContain("Other (type your own)"); /* 几何未定稿不回放 */
    gate.resolve(null);
    await pending;
    await vi.advanceTimersByTimeAsync(250);
    expect(lastText()).toContain("Other (type your own)"); /* 就绪即回放:重载前挂起面板直接可见 */
    const gate2 = Promise.withResolvers<[number, number] | null>();
    const raced = new AskScreenMirror((id, text) => samples.push([id, text]), () => gate2.promise);
    const pending2 = raced.backfill("s2", addressedFrame(...PANEL_ROWS));
    raced.remove("s2"); /* 回放途中会话移除 */
    gate2.resolve(null);
    await pending2;
    await vi.advanceTimersByTimeAsync(250);
    expect(samples.filter((s) => s[0] === "s2").some((s) => s[1].includes("Other"))).toBe(false);
    gated.resetForTest();
    raced.resetForTest();
  });

  it("自愈:面板被后续整帧覆盖,采样随新现势失标", async () => {
    mirror.feed("s1", addressedFrame(...PANEL_ROWS));
    await vi.advanceTimersByTimeAsync(250);
    expect(lastText()).toContain("Other (type your own)");
    /* CLI 自行继续:整帧重绘推进屏幕,面板滚出 —— 等待态消失必须可观测 */
    const out = Array.from({ length: 40 }, (_, i) => `out ${i}`);
    mirror.feed("s1", "\r\n" + plain(...out)); /* 帧首换行:面板末行与 out 0 不并 row */
    await vi.advanceTimersByTimeAsync(250);
    expect(lastText()).not.toContain("Ask");
    expect(lastText()).toBe(screen(out.slice(-32)));
  });

  it("幕布互斥:在册会话不吃流不采样;reseed 以幕布终态补种,注销后接管", async () => {
    const handle = {} as TerminalHandle; /* 镜像只看在册与否,不调成员 */
    registerTerminalHandle("s1", handle);
    mirror.feed("s1", plain(...PANEL_ROWS)); /* 在册:字节不进镜像(feed 互斥) */
    mirror.feed("s2", plain(...PANEL_ROWS));
    await vi.advanceTimersByTimeAsync(500);
    expect(sampleIds()).toEqual(["s2", "s2"]); /* s1 在册跳过,s2 照发 */
    /* 幕布卸载时序:reseed 以幕布终态同步补种(注销 handle 之前),采样首发即现势 */
    mirror.reseed("s1", 120, 24, PANEL_ROWS.join("\r\n"));
    unregisterTerminalHandle("s1", handle);
    await vi.advanceTimersByTimeAsync(250);
    expect(sampleIds()).toEqual(["s1", "s2", "s2", "s2"]); /* s1 接管(含此前 s2 两发) */
    expect(lastText()).toBe(screen(PANEL_ROWS)); /* 接管首发即幕布终态 */
    /* 注销后字节恢复直喂:整帧覆盖补种态 */
    const next = Array.from({ length: 24 }, (_, i) => `post ${i}`);
    mirror.feed("s1", addressedFrame(...next));
    await vi.advanceTimersByTimeAsync(250);
    expect(lastText()).toBe(screen(next));
  });

  it("整帧幂等:分片入站与同帧重放屏幕态不变", async () => {
    const f = addressedFrame(...PANEL_ROWS);
    mirror.feed("s1", f.slice(0, 40)); /* PTY chunk 粒度任意,转义序列跨片不断 */
    mirror.feed("s1", f.slice(40));
    mirror.feed("s1", f); /* 整帧重放(重复事件) */
    await vi.advanceTimersByTimeAsync(250);
    expect(lastText()).toBe(screen(PANEL_ROWS));
    expect(lastText().split("Other (type your own)")).toHaveLength(2); /* 不叠影不重复 */
  });

  it("乱序整帧:末写帧覆盖先到态,屏面是现势不是日志", async () => {
    const aRows = Array.from({ length: 24 }, (_, i) => `A ${i}`);
    const bRows = Array.from({ length: 24 }, (_, i) => `B ${i}`);
    mirror.feed("s1", addressedFrame(...aRows));
    mirror.feed("s1", addressedFrame(...bRows));
    await vi.advanceTimersByTimeAsync(250);
    expect(lastText()).toBe(screen(bRows));
    mirror.feed("s2", addressedFrame(...bRows));
    mirror.feed("s2", addressedFrame(...aRows)); /* 反序到达,末写帧同样胜出 */
    await vi.advanceTimersByTimeAsync(250);
    const s2Text = samples.find((s) => s[0] === "s2")![1];
    expect(s2Text).toBe(screen(aRows));
    expect(s2Text).not.toContain("B 23"); /* 先到帧无残影 */
  });

  it("remove:镜像消亡不再采样;末镜像移除后计时器停摆;未知 id no-op", async () => {
    mirror.feed("s1", plain(...PANEL_ROWS));
    mirror.remove("nope"); /* 未知 id 不抛不扰 */
    await vi.advanceTimersByTimeAsync(250);
    expect(sampleIds()).toEqual(["s1"]);
    mirror.remove("s1");
    samples = [];
    await vi.advanceTimersByTimeAsync(500);
    expect(samples).toEqual([]); /* 已删会话不复活 */
    /* 计时器停摆后再养镜像:每 tick 恰一发(stop/start 对称,泄漏的旧 interval 会翻倍) */
    mirror.feed("s2", plain(...PANEL_ROWS));
    await vi.advanceTimersByTimeAsync(500);
    expect(sampleIds()).toEqual(["s2", "s2"]);
  });

  it("remove 清未建镜像的 pendingSize:暂存尺寸不泄漏到同 id 重建", async () => {
    mirror.resize("s1", 200, 48); /* 中继先于首字节 */
    mirror.remove("s1"); /* 会话消亡时镜像尚未建立(SSH/未 feed 会话路径) */
    const rows = Array.from({ length: 40 }, (_, i) => `row ${i}`);
    mirror.feed("s1", plain(...rows) + "\r\n"); /* 同 id 重建:默认 120×32 */
    await vi.advanceTimersByTimeAsync(250);
    expect(lastText()).not.toContain("row 0\n"); /* 40 行在 32 行栅格滚掉头 8 行;泄漏的 48 行栅格会全显 */
  });

  it("remove 后同 id 重建:全新空屏,旧面板字节不复活", async () => {
    mirror.feed("s1", plain(...PANEL_ROWS));
    await vi.advanceTimersByTimeAsync(250);
    mirror.remove("s1");
    const idle = Array.from({ length: 24 }, (_, i) => `idle ${i}`);
    mirror.feed("s1", plain(...idle));
    await vi.advanceTimersByTimeAsync(250);
    const text = samples.find((s) => s[0] === "s1" && s[1].includes("idle 23"))![1];
    expect(text).toBe(screen(idle));
    expect(text).not.toContain("Ask");
  });

  it("resetForTest:全态归零不再采样,归零后可复用", async () => {
    mirror.feed("s1", plain(...PANEL_ROWS));
    mirror.resetForTest();
    await vi.advanceTimersByTimeAsync(500);
    expect(samples).toEqual([]);
    mirror.feed("s2", plain(...PANEL_ROWS)); /* 归零后计时器重启,镜像照常工作 */
    await vi.advanceTimersByTimeAsync(250);
    expect(samples).toEqual([["s2", screen(PANEL_ROWS)]]);
  });
});
