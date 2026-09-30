/**
 * 活会话转录浮层纯逻辑测试 —— 模式 store(切换/订阅/退出剪除)与尾窗切片。
 * 轮询/跟随属 IPC+DOM 集成面,由 1421 桩目检覆盖(设计 spec 验证节)。
 */
import { describe, expect, it } from "vitest";
import type { CliTranscriptBlock } from "@kernel/cli";
import {
  isLiveTranscript,
  pruneLiveTranscript,
  setLiveTranscript,
  subscribeLiveMode,
  tailWindow,
} from "./liveMode";

describe("liveMode store", () => {
  it("开关切换 + 订阅通知(本组件切换/剪除都要驱动重渲染)", () => {
    const hits: number[] = [];
    const off = subscribeLiveMode(() => hits.push(1));
    expect(isLiveTranscript("s1")).toBe(false);
    setLiveTranscript("s1", true);
    expect(isLiveTranscript("s1")).toBe(true);
    setLiveTranscript("s1", false);
    expect(isLiveTranscript("s1")).toBe(false);
    /* 关闭即删键,不残留 false 项(Map 语义 = 只存开) */
    pruneLiveTranscript("s1");
    expect(hits.length).toBe(2); // 剪除无变化不再通知
    off();
    setLiveTranscript("s2", true);
    expect(hits.length).toBe(2); // 退订后静默
  });

  it("会话级独立记忆:切走再切回保留各自形态,退出剪除互不影响", () => {
    setLiveTranscript("a", true);
    setLiveTranscript("b", false);
    expect(isLiveTranscript("a")).toBe(true);
    expect(isLiveTranscript("b")).toBe(false);
    pruneLiveTranscript("a");
    expect(isLiveTranscript("a")).toBe(false);
  });
});

describe("tailWindow 尾窗切片", () => {
  const block = (id: number): CliTranscriptBlock =>
    ({ id: `b${id}`, role: "assistant", text: `t${id}` }) as CliTranscriptBlock;

  it("live 视角只看尾部:超出取末尾 visible 块,不足整卷直通(引用保稳)", () => {
    const blocks = [1, 2, 3, 4, 5].map(block);
    expect(tailWindow(blocks, 3).map((b) => b.id)).toEqual(["b3", "b4", "b5"]);
    const all = tailWindow(blocks, 10);
    expect(all).toBe(blocks); // 未截断时原引用直通,分批 memo 命中
    expect(tailWindow([], 200)).toEqual([]);
  });
});

