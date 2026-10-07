/** 会话引用标记测试:变换/校验/降级/href 往返。 */
import { describe, expect, it } from "vitest";
import { SESSION_LINK_PREFIX, sessionKeyFromHref, sessionRefKey, withSessionLinks } from "./sessionRef";

const ok = (k: string): boolean => k === sessionRefKey("21:14", "omp", "0.3.2 规划");

describe("withSessionLinks", () => {
  it("校验命中:标记转 md 链接,href 携归一键", () => {
    const out = withSessionLinks("完成了 [会话|21:14|omp|0.3.2 规划] 的断点排查", ok);
    expect(out).toBe(
      `完成了 [0.3.2 规划](${SESSION_LINK_PREFIX}${encodeURIComponent("21:14|omp|0.3.2 规划")}) 的断点排查`,
    );
  });

  it("校验未命中(LLM 编造/漂移):降级纯文本标题,不外露标记语法", () => {
    const out = withSessionLinks("见 [会话|23:59|kimi|不存在的会话] 与 [会话|21:14|omp|标题被改写]", ok);
    expect(out).toBe("见 不存在的会话 与 标题被改写");
  });

  it("无标记文本原样;同一标记多次出现各自处理", () => {
    expect(withSessionLinks("普通正文", ok)).toBe("普通正文");
    const twice = withSessionLinks("[会话|21:14|omp|0.3.2 规划] 然后 [会话|21:14|omp|0.3.2 规划]", ok);
    expect(twice.match(new RegExp(SESSION_LINK_PREFIX.slice(1), "g"))).toHaveLength(2);
  });

  it("标题含方括号/未配对括号:链接文本与 href 转义,解码还原(不产死链)", () => {
    const key = sessionRefKey("21:14", "omp", "修复(wip");
    const out = withSessionLinks("[会话|21:14|omp|修复(wip]", (k) => k === key);
    expect(out).toBe(`[修复(wip](${SESSION_LINK_PREFIX}${encodeURIComponent(key).replace("(", "%28")})`);
    const bracket = withSessionLinks("[会话|21:14|omp|a[b 修复]", () => true);
    expect(bracket).toContain("a\\[b 修复");
  });
});

describe("sessionKeyFromHref", () => {
  it("href 往返还原归一键;外来锚点返回 null", () => {
    const key = sessionRefKey("21:14", "omp", "0.3.2 规划");
    expect(sessionKeyFromHref(`${SESSION_LINK_PREFIX}${encodeURIComponent(key)}`)).toBe(key);
    expect(sessionKeyFromHref("#other-anchor")).toBeNull();
    expect(sessionKeyFromHref("")).toBeNull();
  });
});
