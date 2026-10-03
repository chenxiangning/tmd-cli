/**
 * 三态胶囊 composer 渲染契约(react-dom/server 静态渲染,模式同 SpawnSheet.test):
 * - 常态空稿:胶囊条 + 「打开面板」加号;发送蓝圆/chips 不出现,键条默认在场;
 * - 有内容(文字或纯图同权):发送蓝圆顶替加号;
 * - 挂图态:缩略卡 + ✕ + 「再加一张」瓷砖 + 三条提示 chips(参考图文案);
 * - 面板四格(相册/切模型/检查点/快捷键):无 cwd 检查点置灰,快捷键格随 kbOn 点亮;
 * - CHIP_PROMPTS 标签与预填词成对(点 chip 填草稿由人确认发送)。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@kernel/i18n", () => ({
  t: (k: string, p?: Record<string, string>) =>
    p ? Object.entries(p).reduce((s, [name, v]) => s.replace(`{${name}}`, v), k) : k,
}));
const ctx = vi.hoisted(() => ({ write: vi.fn(async () => undefined) }));
vi.mock("./remote", () => ({ writeSession: ctx.write }));
vi.mock("./shared", () => ({ KEYS: [{ label: "esc", aria: "Esc", seq: "\u001b" }] }));

import { Composer, PlusPanel } from "./Composer";
import { CHIP_PROMPTS, joinPrompt } from "./composerChips";

const base = {
  sessionId: "s1",
  draft: "",
  onDraft: () => undefined,
  onSend: () => undefined,
  sending: false,
  sendErr: false,
  shotErr: false,
  onRetry: () => undefined,
  shots: [] as { path: string; url: string }[],
  shotBusy: false,
  onShot: () => undefined,
  onRemoveShot: () => undefined,
  onPreview: () => undefined,
  ckptReady: true,
  onCkpt: () => undefined,
};

function render(over: Partial<typeof base> = {}): string {
  return renderToStaticMarkup(createElement(Composer, { ...base, ...over }));
}

const shot = { path: "/tmp/shot-1.jpg", url: "blob:x" };
const panelBase = { shotBusy: false, ckptReady: true, kbOn: true, onShot: () => undefined, onModel: () => undefined, onCkpt: () => undefined, onToggleKb: () => undefined };

describe("三态胶囊 composer 渲染契约", () => {
  it("空稿常态:加号开面板,发送圆与 chips 不出现,键条默认在场", () => {
    const html = render();
    expect(html).toContain("cp-pill");
    expect(html).toContain("打开面板");
    expect(html).not.toContain("cp-send");
    expect(html).not.toContain("cp-chips");
    expect(html).toContain("keybar");
  });

  it("有内容即出发送蓝圆:文字稿与纯图同权", () => {
    expect(render({ draft: "hi" })).toContain("cp-send");
    expect(render({ shots: [shot] })).toContain("cp-send");
  });

  it("挂图态:缩略卡 ✕ + 加号瓷砖 + 三条提示 chips", () => {
    const html = render({ shots: [shot] });
    expect(html).toContain("shot-x");
    expect(html).toContain("cp-shot-add");
    expect(html).toContain("cp-chips");
    for (const c of CHIP_PROMPTS) expect(html).toContain(c.label);
  });

  it("CHIP_PROMPTS 标签与预填词成对,顺序同参考图", () => {
    expect(CHIP_PROMPTS.map((c) => c.label)).toEqual(["提取图中文字", "图片配文", "翻译图中文字"]);
    expect(CHIP_PROMPTS.every((c) => c.prompt.trim().length > 0)).toBe(true);
  });

  it("joinPrompt:空稿直填,非空稿换行追加不覆盖(保已打文字)", () => {
    expect(joinPrompt("", "请提取图片中的文字")).toBe("请提取图片中的文字");
    expect(joinPrompt("看下这张图", "请提取图片中的文字")).toBe("看下这张图\n请提取图片中的文字");
    expect(joinPrompt("看下这张图\n", "请提取图片中的文字")).toBe("看下这张图\n请提取图片中的文字");
  });

  it("面板四格:检查点无 cwd 置灰,快捷键格随键条开关点亮", () => {
    const on = renderToStaticMarkup(createElement(PlusPanel, panelBase));
    for (const label of ["相册", "切模型", "检查点", "快捷键"]) expect(on).toContain(label);
    expect(on).toContain("cp-tile on");
    expect(on).not.toContain("disabled");
    const off = renderToStaticMarkup(createElement(PlusPanel, { ...panelBase, ckptReady: false, kbOn: false }));
    expect(off).toContain("disabled");
    expect(off).not.toContain("cp-tile on");
  });
});
