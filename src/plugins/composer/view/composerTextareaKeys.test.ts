/**
 * composerTextareaKeyDown 按键判别表契约(判定顺序:IME → 下拉 → ghost Tab → 历史 → 移交/发送):
 * - IME 组合中(isComposing)一律不拦截:下拉导航/选候选/ghost/历史/移交/发送全部让路,
 *   按键交给输入法确认候选(2026-09-19 IME Enter 泄漏教训的回归防线)。
 * - 下拉打开:↑↓ 循环移动候选(末位回 0、首位回末位,空候选归 0 且 Enter 不炸);
 *   Enter/Tab 应用 pickIndex 候选(Tab 优先于 ghost);Escape 关闭下拉;此间不触发送。
 * - ghost 补全:仅无下拉 + 光标在末尾时 Tab 触发;accept 回 null 不写入,但已拦截。
 * - 历史召回:无下拉时空输入 ↑↓ 先问 handleHistoryNav,消费即止(不拦截不移交)。
 * - 幕布移交:历史不消费 + 空输入 ↑↓ → preventDefault 并把焦点交给活动会话终端;
 *   非空输入是光标移动不移交;无活动会话只拦截不聚焦。
 * - Enter 发送:enter 模式裸 Enter 发送、Shift+Enter 换行;cmdOrCtrlEnter 模式 ⌘/Ctrl+Enter
 *   发送、裸 Enter 换行;组合中一律不发送。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyboardEvent, SetStateAction } from "react";
import type { SendShortcut } from "@kernel/settings";
import type { SuggestionMatch } from "../triggers/suggest";
import { composerTextareaKeyDown } from "./composerTextareaKeys";

const hostMock = vi.hoisted(() => ({
  getActiveSessionId: vi.fn<() => string | null>(() => "sid-1"),
}));
const terminalFocus = vi.hoisted(() => ({ focus: vi.fn() }));
vi.mock("@kernel/host", () => ({ host: hostMock }));
vi.mock("@kernel/messageAnchors", () => ({
  getTerminalHandle: vi.fn(() => ({ focus: terminalFocus.focus })),
}));
import { getTerminalHandle } from "@kernel/messageAnchors";

type KeyCtx = Parameters<typeof composerTextareaKeyDown>[1];

const M: SuggestionMatch[] = [{ value: "a" }, { value: "b" }, { value: "c" }];

function keyEv(
  key: string,
  mods: { isComposing?: boolean; shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean } = {},
): KeyboardEvent<HTMLTextAreaElement> {
  return {
    key,
    shiftKey: mods.shiftKey ?? false,
    metaKey: mods.metaKey ?? false,
    ctrlKey: mods.ctrlKey ?? false,
    nativeEvent: { isComposing: mods.isComposing ?? false },
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent<HTMLTextAreaElement>;
}

/** 有状态最小 ctx:pickIndex 经 getter/setter 闭环,可断言循环移动的落点。 */
function makeCtx(
  init: { pickIndex?: number; cursor?: number; value?: string } = {},
  overrides: Record<string, unknown> = {},
): KeyCtx {
  let pickIndex = init.pickIndex ?? 0;
  const ctx = {
    matches: null as SuggestionMatch[] | null,
    get pickIndex() {
      return pickIndex;
    },
    setPickIndex: (u: SetStateAction<number>) => {
      pickIndex = typeof u === "function" ? u(pickIndex) : u;
    },
    applyPick: vi.fn(),
    dismiss: vi.fn(),
    completion: { suffix: "", accept: vi.fn((): string | null => null) },
    get cursor() {
      return init.cursor ?? 0;
    },
    get value() {
      return init.value ?? "";
    },
    handleHistoryNav: vi.fn((): boolean => false),
    sendShortcut: "enter" as SendShortcut,
    sendCurrent: vi.fn(),
    setValue: vi.fn(),
    setCursor: vi.fn(),
    ...overrides,
  };
  return ctx as unknown as KeyCtx;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("IME 组合中:一切让路", () => {
  it("组合中 ArrowDown 不移动候选、不拦截默认行为", () => {
    const ev = keyEv("ArrowDown", { isComposing: true });
    const ctx = makeCtx({ pickIndex: 0 }, { matches: M });
    composerTextareaKeyDown(ev, ctx);
    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(ctx.pickIndex).toBe(0);
  });

  it("组合中 Enter 不选候选也不发送(输入法确认优先)", () => {
    const ev = keyEv("Enter", { isComposing: true });
    const ctx = makeCtx({ pickIndex: 1 }, { matches: M });
    composerTextareaKeyDown(ev, ctx);
    expect(ctx.applyPick).not.toHaveBeenCalled();
    expect(ctx.sendCurrent).not.toHaveBeenCalled();
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it("组合中 Tab 不做 ghost 补全", () => {
    const ev = keyEv("Tab", { isComposing: true });
    const ctx = makeCtx({ cursor: 3, value: "abc" }, { completion: { suffix: "d", accept: () => "abcd" } });
    composerTextareaKeyDown(ev, ctx);
    expect(ctx.setValue).not.toHaveBeenCalled();
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it("组合中裸 Enter(无下拉)不发送", () => {
    const ev = keyEv("Enter", { isComposing: true });
    const ctx = makeCtx();
    composerTextareaKeyDown(ev, ctx);
    expect(ctx.sendCurrent).not.toHaveBeenCalled();
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it("组合中空输入 ArrowUp 不移交幕布", () => {
    const ev = keyEv("ArrowUp", { isComposing: true });
    composerTextareaKeyDown(ev, makeCtx());
    expect(getTerminalHandle).not.toHaveBeenCalled();
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });
});

describe("下拉打开:候选导航与选中", () => {
  it("ArrowDown 循环下移,末位回 0;不触历史召回", () => {
    const ev = keyEv("ArrowDown");
    const historyNav = vi.fn((): boolean => false);
    const ctx = makeCtx({ pickIndex: 2 }, { matches: M, handleHistoryNav: historyNav });
    composerTextareaKeyDown(ev, ctx);
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(ctx.pickIndex).toBe(0);
    expect(historyNav).not.toHaveBeenCalled();
  });

  it("ArrowUp 循环上移,首位回末位", () => {
    const ctx = makeCtx({ pickIndex: 0 }, { matches: M });
    composerTextareaKeyDown(keyEv("ArrowUp"), ctx);
    expect(ctx.pickIndex).toBe(2);
  });

  it("Enter 应用 pickIndex 候选,不触发送", () => {
    const ev = keyEv("Enter");
    const ctx = makeCtx({ pickIndex: 1 }, { matches: M });
    composerTextareaKeyDown(ev, ctx);
    expect(ctx.applyPick).toHaveBeenCalledWith(M[1]);
    expect(ctx.sendCurrent).not.toHaveBeenCalled();
  });

  it("Tab 优先选候选,ghost 补全不参与", () => {
    const accept = vi.fn((): string | null => "abcd");
    const ev = keyEv("Tab");
    const ctx = makeCtx(
      { pickIndex: 0, cursor: 3, value: "abc" },
      { matches: M, completion: { suffix: "d", accept } },
    );
    composerTextareaKeyDown(ev, ctx);
    expect(ctx.applyPick).toHaveBeenCalledWith(M[0]);
    expect(accept).not.toHaveBeenCalled();
    expect(ctx.setValue).not.toHaveBeenCalled();
  });

  it("Escape 关闭下拉", () => {
    const ev = keyEv("Escape");
    const ctx = makeCtx({}, { matches: M });
    composerTextareaKeyDown(ev, ctx);
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(ctx.dismiss).toHaveBeenCalled();
  });

  it("空候选数组:方向键归 0 不炸,Enter 不应用任何候选", () => {
    const down = keyEv("ArrowDown");
    const ctx = makeCtx({}, { matches: [] });
    composerTextareaKeyDown(down, ctx);
    expect(ctx.pickIndex).toBe(0);
    const enter = keyEv("Enter");
    composerTextareaKeyDown(enter, ctx);
    expect(enter.preventDefault).toHaveBeenCalled();
    expect(ctx.applyPick).not.toHaveBeenCalled();
  });
});

describe("ghost 补全:无下拉时 Tab", () => {
  it("光标在末尾且 accept 有结果:写入全文并移动光标到末尾", () => {
    const ev = keyEv("Tab");
    const ctx = makeCtx(
      { cursor: 3, value: "abc" },
      { completion: { suffix: "d", accept: () => "abcd" } },
    );
    composerTextareaKeyDown(ev, ctx);
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(ctx.setValue).toHaveBeenCalledWith("abcd");
    expect(ctx.setCursor).toHaveBeenCalledWith(4);
  });

  it("光标不在末尾:ghost 不触发、不拦截", () => {
    const accept = vi.fn((): string | null => "abcd");
    const ctx = makeCtx(
      { cursor: 1, value: "abc" },
      { completion: { suffix: "d", accept } },
    );
    composerTextareaKeyDown(keyEv("Tab"), ctx);
    expect(accept).not.toHaveBeenCalled();
    expect(ctx.setValue).not.toHaveBeenCalled();
  });

  it("accept 回 null:不写入,但按键已消费", () => {
    const ev = keyEv("Tab");
    const ctx = makeCtx(
      { cursor: 3, value: "abc" },
      { completion: { suffix: "d", accept: () => null } },
    );
    composerTextareaKeyDown(ev, ctx);
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(ctx.setValue).not.toHaveBeenCalled();
    expect(ctx.setCursor).not.toHaveBeenCalled();
  });
});

describe("历史召回与幕布移交", () => {
  it("空输入 ArrowUp:历史召回消费即止,不移交不拦截", () => {
    const ev = keyEv("ArrowUp");
    const nativeEvent = (ev as unknown as { nativeEvent: unknown }).nativeEvent;
    const ctx = makeCtx({ value: " " }, { handleHistoryNav: vi.fn((): boolean => true) });
    composerTextareaKeyDown(ev, ctx);
    expect(ctx.handleHistoryNav).toHaveBeenCalledWith(nativeEvent);
    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(getTerminalHandle).not.toHaveBeenCalled();
  });

  it("历史消费不了 + 空输入 ArrowDown:preventDefault 并移交幕布焦点", () => {
    const ev = keyEv("ArrowDown");
    composerTextareaKeyDown(ev, makeCtx({ value: " " }));
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(getTerminalHandle).toHaveBeenCalledWith("sid-1");
    expect(terminalFocus.focus).toHaveBeenCalled();
  });

  it("非空输入 ArrowUp:是光标移动,不移交", () => {
    const ev = keyEv("ArrowUp");
    composerTextareaKeyDown(ev, makeCtx({ value: "abc" }));
    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(getTerminalHandle).not.toHaveBeenCalled();
  });

  it("无活动会话:只拦截,不聚焦", () => {
    hostMock.getActiveSessionId.mockReturnValueOnce(null);
    const ev = keyEv("ArrowDown");
    composerTextareaKeyDown(ev, makeCtx({ value: " " }));
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(getTerminalHandle).not.toHaveBeenCalled();
  });
});

describe("Enter 发送", () => {
  it("enter 模式:裸 Enter 拦截并发送", () => {
    const ev = keyEv("Enter");
    const ctx = makeCtx();
    composerTextareaKeyDown(ev, ctx);
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(ctx.sendCurrent).toHaveBeenCalled();
  });

  it("enter 模式:Shift+Enter 换行,不发送", () => {
    const ev = keyEv("Enter", { shiftKey: true });
    const ctx = makeCtx();
    composerTextareaKeyDown(ev, ctx);
    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(ctx.sendCurrent).not.toHaveBeenCalled();
  });

  it("cmdOrCtrlEnter 模式:裸 Enter 换行,⌘/Ctrl+Enter 发送", () => {
    const bare = keyEv("Enter");
    const ctx = makeCtx({}, { sendShortcut: "cmdOrCtrlEnter" as SendShortcut });
    composerTextareaKeyDown(bare, ctx);
    expect(ctx.sendCurrent).not.toHaveBeenCalled();

    const cmd = keyEv("Enter", { metaKey: true });
    composerTextareaKeyDown(cmd, ctx);
    expect(ctx.sendCurrent).toHaveBeenCalledTimes(1);

    const ctrl = keyEv("Enter", { ctrlKey: true });
    composerTextareaKeyDown(ctrl, ctx);
    expect(ctx.sendCurrent).toHaveBeenCalledTimes(2);
  });
});
