/**
 * OutputBufferStore 契约:
 * append —— 返回该 chunk 的 UTF-8 字节数(CJK 多字节计入);块只 push 不拼接;
 * get —— 按到达顺序返回全部输出;无会话返回空串;
 * 截断 —— totalChars 超 1.2×limit 才触发(迟滞),截后保留尾部且不劈开转义序列;
 * getBytes —— O(1) 读累计 UTF-8 字节数;恒等于 get() 的实际字节长(含截断后重计);
 * remove —— 清除缓冲,之后 get/getBytes 归零,append 重新起账;
 * 会话间隔离 —— 同 id 一本账,不同 id 互不可见。
 */
 import { describe, expect, it } from "vitest";
 import { OutputBufferStore } from "./outputBuffers";
import { registerTerminalHandle, unregisterTerminalHandle, type TerminalHandle } from "./terminalHandles";

const enc = new TextEncoder();

describe("append 返回字节数", () => {
  it("ASCII 单字节按字符数返回", () => {
    const store = new OutputBufferStore();
    expect(store.append("s", "abc", 100)).toBe(3);
  });

  it("CJK 多字节按 UTF-8 字节数返回,不是字符数", () => {
    const store = new OutputBufferStore();
    expect(store.append("s", "中文", 100)).toBe(6);
  });

  it("逐 chunk 返回值之和等于全量字节数(块边界不劈码点)", () => {
    const store = new OutputBufferStore();
    const text = "a中👍b文";
    let total = 0;
    /* 逐字符切包:PTY 按完整码点切,bytes 和 === 整段编码 */
    for (const ch of text) total += store.append("s", ch, 1000);
    expect(total).toBe(enc.encode(text).length);
  });
});

describe("get 回放", () => {
  it("无会话返回空串;有会话按到达顺序拼接", () => {
    const store = new OutputBufferStore();
    expect(store.get("nope")).toBe("");
    store.append("s", "he", 100);
    store.append("s", "llo", 100);
    expect(store.get("s")).toBe("hello");
  });
});

describe("截断(1.2× 迟滞)", () => {
  it("未超 1.2×limit 不截断,全量保留", () => {
    const store = new OutputBufferStore();
    const text = "x".repeat(120);
    store.append("s", text, 100);
    expect(store.get("s")).toBe(text);
  });

  it("超 1.2×limit 后 get 返回尾部,旧内容被截掉", () => {
    const store = new OutputBufferStore();
    store.append("s", "1".repeat(200), 100);
    const tail = store.get("s");
    expect(tail.length).toBeLessThanOrEqual(100);
    expect(tail.endsWith("1")).toBe(true);
    /* 截后尾部必须来自原文的后缀(保留最后 limit 个字符的语义) */
    expect("1".repeat(200).endsWith(tail)).toBe(true);
  });

  it("截断点避开未完结转义序列:回放流不以残片参数开头", () => {
    const store = new OutputBufferStore();
    /* 大量正文 + 末尾一个长 OSC 序列;若下刀落在序列中间,尾部会出现残缺参数 */
    const osc = "\x1b]8;;https://example.com\x07link\x1b]8;;\x07";
    store.append("s", "y".repeat(200), 100);
    store.append("s", osc, 100);
    const tail = store.get("s");
    /* 转义序列完整保留:开头要么是普通文本,要么是完整 ESC 序列,绝不能出现参数残片 */
    expect(tail.includes("example.com")).toBe(true);
    expect(tail.startsWith("[8;;")).toBe(false);
  });
});

describe("getBytes 字节账本", () => {
  it("无会话返回 0;累计等于全量 UTF-8 字节", () => {
    const store = new OutputBufferStore();
    expect(store.getBytes("nope")).toBe(0);
    store.append("s", "ab", 1000);
    store.append("s", "中", 1000);
    expect(store.getBytes("s")).toBe(2 + 3);
  });

  it("不变量:任意追加/截断序列后,getBytes 恒等于 get 的实际字节长", () => {
    const store = new OutputBufferStore();
    const seed = (len: number, fill: string) => fill.repeat(len);
    /* 先超限触发截断(重计账本),再追加含多字节文本(增量累计) */
    store.append("s", seed(200, "a"), 100);
    store.append("s", seed(30, "中"), 100);
    expect(store.getBytes("s")).toBe(enc.encode(store.get("s")).length);
  });
});

describe("remove 与会话隔离", () => {
  it("remove 清缓冲;再 append 从零起账", () => {
    const store = new OutputBufferStore();
    store.append("s", "old", 100);
    store.remove("s");
    expect(store.get("s")).toBe("");
    expect(store.getBytes("s")).toBe(0);
    store.append("s", "new", 100);
    expect(store.get("s")).toBe("new");
    expect(store.getBytes("s")).toBe(3);
  });

  it("remove 未知会话是安全 no-op;不同会话缓冲互不影响", () => {
    const store = new OutputBufferStore();
    expect(() => store.remove("ghost")).not.toThrow();
    store.append("a", "A", 100);
    store.append("b", "B", 100);
    store.remove("a");
    expect(store.get("a")).toBe("");
    expect(store.get("b")).toBe("B");
  });
});

describe("全店预算(多会话内存治理)", () => {
  it("超 8M 总量时截最久未写会话到 64K 尾,保护最近 tabsMax(默认 4)个", () => {
    const store = new OutputBufferStore();
    /* 单会话上限放大绕开自身截断,让全店预算成为唯一约束;
     * 6 会话各 1.5M = 9M > 8M:前 2 个(最久未写)被截,后 4 个受保护。 */
    const big = 10_000_000;
    for (let i = 1; i <= 6; i++) store.append(`s${i}`, String(i).repeat(1_500_000), big);
    expect(store.get("s1").length).toBeLessThanOrEqual(64_000);
    /* 9M−8M 缺口 1M:截 s1(释放约 1.44M)即达标,s2 起保留 */
    expect(store.get("s2").length).toBe(1_500_000);
    expect(store.get("s3").length).toBe(1_500_000);
    expect(store.get("s6").length).toBe(1_500_000);
    /* 被截者尾部仍可继续追加 */
    store.append("s1", "tail", 100_000);
    expect(store.get("s1").endsWith("tail")).toBe(true);
  });

  it("总量未超预算时零裁剪", () => {
    const store = new OutputBufferStore();
    store.append("a", "x".repeat(1_000), 100_000);
    store.append("b", "y".repeat(1_000), 100_000);
    expect(store.get("a").length).toBe(1_000);
    expect(store.get("b").length).toBe(1_000);
  });

  it("挂载真相保护:注册表有 handle 的会话即使最旧也不裁,裁无 handle 者", () => {
    const store = new OutputBufferStore();
    const big = 10_000_000;
    /* 最旧的 mt-1 挂载中(观看≠写入,MRU 保护错域);先注册再灌量,
       否则第 6 次追加过预算时 mt-1 已被裁。 */
    const handle = {} as TerminalHandle;
    registerTerminalHandle("mt-1", handle);
    try {
      /* 6 会话各 1.5M = 9M > 8M */
      for (let i = 1; i <= 6; i++) store.append(`mt-${i}`, String(i).repeat(1_500_000), big);
      store.append("mt-7", "x", big); /* 再触发预算执行 */
      expect(store.get("mt-1").length).toBe(1_500_000); /* 挂载中不裁 */
      expect(store.get("mt-2").length).toBeLessThanOrEqual(64_000); /* 无 handle 最旧先裁 */
      expect(store.get("mt-3").length).toBe(1_500_000); /* 缺口已补,后续不裁 */
    } finally {
      unregisterTerminalHandle("mt-1", handle);
    }
  });
});
