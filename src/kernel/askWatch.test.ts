/**
 * AskWatch v2 行为契约测试(候选确认制 + 结算自愈)—— 核心状态机段,
 * 自 askWatch.test.ts 拆出(文件规模铁则收紧至 300 行)。
 *
 * 覆盖:候选确认窗(首击立候选不置位 → 复现且距首击 ≥1.2s 才升级,或守望计时器
 * 漂移确认)、瞬态内容撤销(作答残影不复燃 / resume 回放历史面板不错绑 —— 两个实测
 * bug 的回归测试,字节序列取自 ~/.tmd-cli session 日志的 omp 真实帧序)、等待中边沿
 * 去重、静默自愈(尾巴无字面量摘除残签 / 真面板保守保留)、用户作答清除 + 尾巴重置、
 * 会话移除清理。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AskWatch, stripAnsi } from "./askWatch";

/** omp Ask 面板样例(带 ANSI 样式,取自真实输出形态)。 */
const OMP_ASK =
  "\x1b[1mAsk 1 questions\x1b[0m\r\n\x1b[2m[plan_confirm] · options:3\x1b[0m";

/** omp ask 工具面板尾部(真实字节形态):问题+长选项渲染后,「Ask N questions」
 *  头部已被推出 240 字符尾窗,只有底部字面量落在页脚窗口 —— 实测漏报根因。 */
const OMP_ASK_TOOL_TAIL =
  "\x1b[38;2;107;114;128m│\x1b[39m   \x1b[38;2;107;114;128m○\x1b[39m \x1b[39m保留 CLI 分组,组内时间轴化\x1b[39m\r\n" +
  "\x1b[38;2;107;114;128m│\x1b[39m   \x1b[38;2;107;114;128m○\x1b[39m \x1b[39m混合:默认合并,可切回分组\x1b[39m\r\n" +
  "\x1b[38;2;107;114;128m│\x1b[39m   \x1b[38;2;107;114;128m○\x1b[39m \x1b[39mOther (type your own)\x1b[39m";

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
describe("AskWatch 标记检测与状态迁移(候选确认制)", () => {
  let watch: AskWatch;

  beforeEach(() => {
    vi.useFakeTimers();
    watch = new AskWatch();
    fire = (id, text) => watch.onOutput(id, text, text.length, TEST_ASK_MARKS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("omp Ask 面板:首击只立候选不置位,复现且过确认窗才升级", async () => {
    expect(fire("s1", OMP_ASK)).toBe(false);
    expect(watch.isWaiting("s1")).toBe(false);
    await pastConfirm();
    expect(fire("s1", OMP_ASK)).toBe(true);
    expect(watch.isWaiting("s1")).toBe(true);
  });

  it("确认窗内的复现(距首击 <1.2s)不升级,满窗后那次才升级", async () => {
    fire("s2", OMP_ASK);
    await vi.advanceTimersByTimeAsync(500);
    expect(fire("s2", OMP_ASK)).toBe(false);
    expect(watch.isWaiting("s2")).toBe(false);
    await vi.advanceTimersByTimeAsync(900); // 距首击已 1.4s
    expect(fire("s2", OMP_ASK)).toBe(true);
  });

  it("字节缺口撤销:标记随流远去(超 16KB 无复现)候选撤销,后续重新观察", async () => {
    fire("s3", OMP_ASK); // 面板帧
    fire("s3", "r".repeat(17_000)); // 响应流冲远,缺口超限撤销
    await pastConfirm();
    expect(fire("s3", OMP_ASK)).toBe(false); // 重新立候选
    await pastConfirm();
    expect(fire("s3", OMP_ASK)).toBe(true);
    expect(watch.isWaiting("s3")).toBe(true);
  });

  it("静态面板 + 状态栏细水长流:标记被挤出尾巴仍由漂移确认升级(实测漏报回归)", async () => {
    /* omp 交互 Ask 面板光标停住后不再重绘;状态栏/spinner 持续小流量输出,
       累计 >1024B 把标记挤出尾巴,但 <4KB 漂移阈 —— 面板真在等用户 */
    fire("sA", OMP_ASK);
    const statusTick = "\x1b[2K⠙ Working 模型 minimax 额度 5h 35%\r"; // ≈45B
    for (let i = 0; i < 30; i++) {
      await vi.advanceTimersByTimeAsync(80); // 总计 2.4s,跨过确认窗
      fire("sA", statusTick); // 累计 ≈1350B:尾巴早已无标记
    }
    expect(watch.isWaiting("sA")).toBe(true);
  });

  it("命中后真实响应流(>16KB)流出:计时器按漂移就地撤销候选", async () => {
    fire("sB", OMP_ASK); // 首击立候选
    fire("sB", "r".repeat(9_000));
    await vi.advanceTimersByTimeAsync(600); // 确认窗内,继续流
    fire("sB", "r".repeat(9_000)); // 累计 18KB > 16KB 漂移阈
    await pastConfirm(); // 计时器期满:漂移超阈撤销,不升级
    expect(watch.isWaiting("sB")).toBe(false);
    /* 撤销后可重新观察 */
    expect(fire("sB", OMP_ASK)).toBe(false);
    await pastConfirm();
    expect(fire("sB", OMP_ASK)).toBe(true);
  });

  it("resume 回放的历史面板文本是瞬态:流式滚过不错绑(bug 2 回归)", async () => {
    /* 切换会话 → 回放整段 transcript,历史面板夹在正文中间一闪而过 */
    const replay = [
      "╭─ transcript ───╮",
      OMP_ASK,
      "user answered long ago",
      "loads of transcript lines follow",
      "╰─ end ───╯",
    ].join("\r\n");
    expect(fire("s4", replay)).toBe(false);
    await pastConfirm();
    expect(fire("s4", "replay continues\r\n")).toBe(false);
    expect(watch.isWaiting("s4")).toBe(false);
  });

  it("claude 确认页脚 / 通用 y-n / Do you want 句式同样走候选确认", async () => {
    expect(fire("s5", "╭──────────╮\n Esc to cancel")).toBe(false);
    await pastConfirm();
    expect(fire("s5", " Esc to cancel")).toBe(true);
    expect(fire("s6", "Proceed with revert? (y/n)")).toBe(false);
    await pastConfirm();
    expect(fire("s6", "(y/n)")).toBe(true);
    expect(fire("s7", "Do you want to make this edit?")).toBe(false);
    await pastConfirm();
    expect(fire("s7", "Do you want to proceed?")).toBe(true);
  });

  it("普通输出不误报", () => {
    expect(fire("s8", "ESC to exit. Press Enter to continue.")).toBe(false);
    expect(fire("s8", "task completed in 2 questions of 10")).toBe(false);
    expect(watch.isWaiting("s8")).toBe(false);
  });

  it("标记被 PTY 分片劈开仍可确认(中间夹 ANSI)", async () => {
    expect(fire("s9", "\x1b[33mChoose: Esc to can")).toBe(false); // 半截不命中
    expect(fire("s9", "\x1b[0mcel")).toBe(false); // 拼齐命中 → 立候选
    await pastConfirm();
    expect(fire("s9", "redraw still shows: Esc to cancel")).toBe(true);
  });

  it("omp ask 工具面板:头部被长选项推出尾窗,底部字面量照样确认(实测漏报回归)", async () => {
    /* 真实帧序:面板流式渲染,底部 "Other (type your own)" 每帧都在尾窗 */
    expect(fire("s20", OMP_ASK_TOOL_TAIL)).toBe(false);
    await pastConfirm();
    expect(fire("s20", OMP_ASK_TOOL_TAIL)).toBe(true);
    expect(watch.isWaiting("s20")).toBe(true);
  });

  it("页脚窗口:标记滚出末 5 行不命中(正文引用不触发)", () => {
    const scrolledOut = "Ask 1 questions\npad1\npad2\npad3\npad4\npad5";
    expect(fire("s10", scrolledOut)).toBe(false);
  });

  it("等待中的重绘不重复触发(边沿去重)", async () => {
    fire("s11", OMP_ASK);
    await pastConfirm();
    fire("s11", OMP_ASK);
    expect(fire("s11", OMP_ASK)).toBe(false);
    expect(watch.isWaiting("s11")).toBe(true);
  });

  it("静态面板静默确认:画完即静默的 omp Ask 面板期满升级(列表不亮标回归)", async () => {
    /* 实测漏报:omp Ask 面板渲染一次后不再重绘,复现确认永不到达;
       守望计时器在候选期满(≥1.2s)且页脚字面量仍守尾巴时升级等待 */
    const asked: string[] = [];
    const w = new AskWatch(undefined, (id) => asked.push(id));
    expect(w.onOutput("s19", OMP_ASK, undefined, TEST_ASK_MARKS)).toBe(false); // 首击只立候选
    expect(w.isWaiting("s19")).toBe(false);
    await vi.advanceTimersByTimeAsync(2_500); // 无任何后续输出
    expect(w.isWaiting("s19")).toBe(true);
    expect(asked).toEqual(["s19"]); // onAsked 边沿回调恰一次
    /* 静态面板长期挂起:尾巴字面量仍在,自愈不误清 */
    await vi.advanceTimersByTimeAsync(10_000);
    expect(w.isWaiting("s19")).toBe(true);
    expect(asked).toHaveLength(1);
  });

  it("静态残影在写后抑制窗内不被静默确认升级", async () => {
    fire("s21", OMP_ASK);
    await pastConfirm();
    fire("s21", OMP_ASK); // 升级等待
    watch.onUserWrite("s21"); // 真作答(写入时确有等待态):上闸
    expect(fire("s21", OMP_ASK)).toBe(false); // 残影立候选
    await vi.advanceTimersByTimeAsync(7_000); // 窗内:确认期满也不升级
    expect(watch.isWaiting("s21")).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000); // 窗过:与复现路径同语义,延迟升级
    expect(watch.isWaiting("s21")).toBe(true);
  });

  it("普通发送(写入时无等待态)后的新提问不上闸:~2s 亮标(不及时根因回归)", async () => {
    watch.onUserWrite("s22"); // 普通发消息:无 ask 状态,不上闸
    await vi.advanceTimersByTimeAsync(2_000);
    fire("s22", OMP_ASK); // 新提问到达(距写入 2s < 8s)
    /* omp 等待期 spinner 细水长流(~313B/100ms):确认时漂移远未达 16KB */
    for (let i = 0; i < 25; i++) {
      await vi.advanceTimersByTimeAsync(100);
      fire("s22", ".".repeat(313));
    }
    /* 守望漂移确认 ~2s 升级;旧行为:上闸 8s + 漂移 ~5.3s 先行撤销 → 永不亮标 */
    expect(watch.isWaiting("s22")).toBe(true);
  });

  it("用户作答清除;残影重绘被写后抑制窗挡住,不再复燃(bug 1 回归)", async () => {
    fire("s12", OMP_ASK);
    await pastConfirm();
    fire("s12", OMP_ASK); // 确认升级
    expect(watch.onUserWrite("s12")).toBe(true);
    expect(watch.isWaiting("s12")).toBe(false);
    /* 实测序列:作答后 omp 整帧重发面板文本 —— 候选立起,但写后抑制窗挡住升级 */
    expect(fire("s12", OMP_ASK)).toBe(false);
    await pastConfirm();
    expect(fire("s12", OMP_ASK)).toBe(false); // 距写入 1.3s < 8s 抑制窗
    expect(watch.isWaiting("s12")).toBe(false);
    /* 响应流把残影推出屏幕:16KB 无复现,候选撤销,永不复燃 */
    fire("s12", "r".repeat(17_000));
    await pastConfirm();
    expect(fire("s12", "more response")).toBe(false);
    expect(watch.isWaiting("s12")).toBe(false);
  });

  it("作答后的下一个提问仍会进入等待(抑制窗只延迟不吞掉,连续多问流程)", async () => {
    fire("s13", OMP_ASK);
    await pastConfirm();
    fire("s13", OMP_ASK);
    watch.onUserWrite("s13");
    /* 下一问在抑制窗内:只延迟 */
    expect(fire("s13", OMP_ASK)).toBe(false);
    await vi.advanceTimersByTimeAsync(9_500);
    /* 抑制窗过后升级:复现/静默确认两路谁先到达均可(守望 tick 网格原点早于写入),
       契约是最终进入等待 */
    expect(watch.isWaiting("s13")).toBe(true);
  });

  it("静默自愈:等待中 CLI 自行继续(响应流过、尾巴无字面量)→ 摘除残签", async () => {
    fire("s14", OMP_ASK);
    await pastConfirm();
    fire("s14", OMP_ASK);
    expect(watch.isWaiting("s14")).toBe(true);
    fire(
      "s14",
      "auto-continued\r\nfull response\r\nstreams many lines\r\npushing the panel out\r\nof the footer window\r\n",
    );
    /* 响应静默 2s 后守望摘签(1Hz 计时器) */
    await vi.advanceTimersByTimeAsync(3_500);
    expect(watch.isWaiting("s14")).toBe(false);
  });

  it("静默保护:尾巴仍有面板字面量(真面板静默挂起)不误清", async () => {
    fire("s15", OMP_ASK);
    await pastConfirm();
    fire("s15", OMP_ASK);
    fire("s15", "last frame still shows the panel footer: Esc to cancel");
    await vi.advanceTimersByTimeAsync(3_500);
    expect(watch.isWaiting("s15")).toBe(true);
  });

  it("未在等待时写入是幂等空操作", () => {
    expect(watch.onUserWrite("s16")).toBe(false);
  });

  it("会话移除清等待;同 id 重建后从零检测", async () => {
    fire("s17", OMP_ASK);
    await pastConfirm();
    fire("s17", OMP_ASK);
    watch.onSessionRemoved("s17");
    expect(watch.isWaiting("s17")).toBe(false);
    fire("s17", OMP_ASK);
    await pastConfirm();
    expect(fire("s17", OMP_ASK)).toBe(true);
  });

  it("resetForTest 全态归零", async () => {
    fire("s18", OMP_ASK);
    watch.resetForTest();
    await pastConfirm();
    expect(fire("s18", OMP_ASK)).toBe(false);
    expect(watch.isWaiting("s18")).toBe(false);
  });

  it("stripAnsi 剥离转义序列(跨 chunk 截断后拼接复原)", () => {
    expect(stripAnsi("text\x1b" + "[31mred\x1b[0m")).toBe("textred");
  });
});
