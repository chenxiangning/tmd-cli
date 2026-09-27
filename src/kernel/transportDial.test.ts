/**
 * 双端点竞速状态机(DialPolicy)矩阵单测(M2 tasks 7.4 代码半边;真机蜂窝
 * 切 relay 归验收清单)。钉死契约:
 * - 单失败不轮换(抖动/桌面重启误切防护),连二败才换下一候选且清闸短等;
 * - 退避曲线 1s→2s→…封顶 10s;成功/轮换各自复位;
 * - arm(手动切换/回前台)清全部状态回首候选;
 * - 单端点凭证(旧格式)永不轮换;候选表收缩时 index 取模不越界。
 * 桥层接线(FakeWS 双候选轮换)见 transport.remote.test.ts。
 */
import { describe, expect, it } from "vitest";
import { DialPolicy } from "./transportDial";

const A = "ws://a";
const B = "ws://b";
const C = "ws://c";

describe("DialPolicy 双端点竞速矩阵", () => {
  it("首败留 A;连二败才换 B(防网络抖动误切)", () => {
    const d = new DialPolicy();
    const first = d.failed([A, B]);
    expect(first.rotated).toBe(false);
    expect(first.delayMs).toBe(1000);
    expect(d.index([A, B])).toBe(0);
    const second = d.failed([A, B]);
    expect(second.rotated).toBe(true);
    expect(d.index([A, B])).toBe(1);
  });

  it("轮换 = 新意图:清退避闸,短等 250ms 再拨", () => {
    const d = new DialPolicy();
    d.failed([A, B]);
    const rotated = d.failed([A, B]);
    expect(rotated.delayMs).toBe(250);
    expect(d.gated(Date.now() + 100)).toBe(false);
  });

  it("三候选连败逐格轮换 A→B→C→A;曲线随成功复位", () => {
    const d = new DialPolicy();
    d.failed([A, B, C]);
    d.failed([A, B, C]);
    expect(d.index([A, B, C])).toBe(1);
    d.failed([A, B, C]);
    d.failed([A, B, C]);
    expect(d.index([A, B, C])).toBe(2);
    d.failed([A, B, C]);
    d.failed([A, B, C]);
    expect(d.index([A, B, C])).toBe(0);
    d.dialed();
    expect(d.failed([A, B, C]).delayMs).toBe(1000);
  });

  it("不退轮换时退避翻倍封顶 10s;闸挡快败重拨", () => {
    const d = new DialPolicy();
    expect(d.failed([A]).delayMs).toBe(1000); // 单候选永不轮换
    expect(d.failed([A]).delayMs).toBe(2000);
    expect(d.gated(Date.now())).toBe(true);
    expect(d.failed([A]).delayMs).toBe(4000);
    expect(d.failed([A]).delayMs).toBe(8000);
    expect(d.failed([A]).delayMs).toBe(10_000);
    expect(d.failed([A]).delayMs).toBe(10_000);
    expect(d.index([A])).toBe(0);
  });

  it("arm(换端点/回前台/显式重连)= 清退避与轮换态回首候选", () => {
    const d = new DialPolicy();
    d.failed([A, B]);
    d.failed([A, B]); // 已轮换到 B
    d.failed([A, B]); // B 也失败一次:闸已排
    d.arm();
    expect(d.index([A, B])).toBe(0);
    expect(d.gated()).toBe(false);
  });

  it("候选表收缩(凭证更新只剩单端点)时 index 取模不越界", () => {
    const d = new DialPolicy();
    d.failed([A, B]);
    d.failed([A, B]); // urlIdx=1
    expect(d.index([A])).toBe(0);
    expect(d.index([])).toBe(0);
  });
});
