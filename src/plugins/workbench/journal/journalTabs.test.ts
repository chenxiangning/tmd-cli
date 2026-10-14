/**
 * 文章 tab 弃稿闸(按 tab id 注册)契约测试 —— 2026-10-13 真机缺陷回归:
 * 闸的可用性必须只取决于「那个 tab 自己在挂」,不得取决于外部挂点。
 * 覆盖:无闸放行 / 装闸生效 / 按 id 路由不串扰 / 摘除幂等 /
 * 旧实例的摘除不误摘新闸(重挂竞态)/ 开路径闸拒绝则不重开。
 * 模块级单例,每个用例经 vi.resetModules + 动态 import 取同一代的全新实例。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./journalFiles", () => ({
  dayKey: (y: number, m: number, d: number) => `${y}-${m}-${d}`,
}));
vi.mock("./dateTitle", () => ({ dayTitleOf: () => "标题" }));

type JournalTabs = typeof import("./journalTabs");

let jt: JournalTabs;

beforeEach(async () => {
  vi.resetModules();
  // 动态 import 例外:被测模块持模块级闸表,必须借 resetModules 取全新实例
  jt = await import("./journalTabs");
});

describe("文章 tab 弃稿闸(按 id)", () => {
  it("无闸:按放行(true),与旧语义一致", async () => {
    await expect(jt.askArticleDiscard("daily-article:2026-10-13")).resolves.toBe(true);
  });

  it("装闸:问的是该 tab 自己的闸(拒绝 = false)", async () => {
    const id = "daily-article:2026-10-13";
    jt.installArticleDiscardGate(id, async () => false);
    await expect(jt.askArticleDiscard(id)).resolves.toBe(false);
  });

  it("按 id 路由:A 的闸不串到 B(B 无闸 = 放行)", async () => {
    jt.installArticleDiscardGate("a", async () => false);
    await expect(jt.askArticleDiscard("a")).resolves.toBe(false);
    await expect(jt.askArticleDiscard("b")).resolves.toBe(true);
  });

  it("摘除幂等:卸载后回落放行,重复摘除不抛", async () => {
    const off = jt.installArticleDiscardGate("a", async () => false);
    off();
    off();
    await expect(jt.askArticleDiscard("a")).resolves.toBe(true);
  });

  it("旧实例的摘除不误摘新闸:tab 重挂后旧卸载回调晚到,按身份校验不摘新闸", async () => {
    const offOld = jt.installArticleDiscardGate("a", async () => true);
    jt.installArticleDiscardGate("a", async () => false); /* 重挂 = 新闸覆盖 */
    offOld(); /* 旧卸载回调晚到 */
    await expect(jt.askArticleDiscard("a")).resolves.toBe(false);
  });

  it("开路径:重开带草稿空日时闸拒绝,则不 refresh(草稿不被静默弃掉)", async () => {
    const tabs = await import("@kernel/tabs");
    const id = `${jt.ARTICLE_TAB_KIND}:2026-10-13`;
    tabs.openTab({
      id,
      kind: jt.ARTICLE_TAB_KIND,
      title: "旧",
      path: "2026-10-13",
      payload: { y: 2026, m: 10, d: 13 },
    });
    tabs.updateTab(id, { dirty: true });
    jt.installArticleDiscardGate(id, async () => false);
    jt.openArticleTab(2026, 10, 13, "新", true);
    await new Promise((r) => setTimeout(r, 0)); /* 等 then 落地 */
    expect(tabs.getTabs()[0].title).toBe("旧");
  });
});
