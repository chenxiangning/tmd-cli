/**
 * 三态胶囊 composer 渲染契约(react-dom/server 静态渲染,模式同 SpawnSheet.test):
 * - 常态空稿:胶囊条 + 「打开面板」加号;发送蓝圆/chips 不出现,键条默认在场;
 * - 双入口:胶囊条左 [相册 Images] + [拍照 Camera] 并排(aria 相册选图/拍照上传);
 * - 有内容(文字或纯图同权):发送蓝圆顶替加号;
 * - 挂图态:缩略卡 + ✕ + 「再加一张」瓷砖 + 三条提示 chips(参考图文案);
 * - 上传中(pending):原图即时 pending 卡(转圈遮罩)上屏;期间发送钮与错误条
 *   重试钮禁用(硬闸在 SessionScreen send 本体,此处 UI affordance);既有挂图
 *   与 chips 与 pending 卡共存(chips 显隐只由 shots 决定);
 * - 错误条按图源分档:album=选图失败 / camera=拍照失败;
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
vi.mock("./shared", () => ({
  KEY_ROWS: [[{ label: "esc", aria: "Esc", seq: "\u001b" }]],
}));

import { Composer } from "./Composer";
import { PlusPanel } from "./plusPanel";
import type { ShotError } from "./useShots";
import { CHIP_PROMPTS, joinPrompt } from "./composerChips";

const base = {
  sessionId: "s1",
  draft: "",
  onDraft: () => undefined,
  onSend: () => undefined,
  sending: false,
  sendErr: false,
  shotErr: null as ShotError | null,
  onRetry: () => undefined,
  shots: [] as { path: string; url: string }[],
  pending: null as string | null,
  shotBusy: false,
  onShot: () => undefined,
  onPhoto: () => undefined,
  onRemoveShot: () => undefined,
  onPreview: () => undefined,
  ckptReady: true,
  onCkpt: () => undefined,
  timelineReady: true,
  onTimeline: () => undefined,
};

function render(over: Partial<typeof base> = {}): string {
  return renderToStaticMarkup(createElement(Composer, { ...base, ...over }));
}

const shot = { path: "/tmp/shot-1.jpg", url: "blob:x" };
const panelBase = { shotBusy: false, ckptReady: true, timelineReady: true, kbOn: true, onShot: () => undefined, onModel: () => undefined, onCkpt: () => undefined, onTimeline: () => undefined, onToggleKb: () => undefined };

describe("三态胶囊 composer 渲染契约", () => {
  it("空稿常态:加号开面板,发送圆与 chips 不出现,键条默认在场", () => {
    const html = render();
    expect(html).toContain("cp-pill");
    expect(html).toContain("grabber"); /* 上下拖拽把手恒在(composer 顶缘) */
    expect(html).toContain("打开面板");
    expect(html).not.toContain("cp-send");
    expect(html).not.toContain("cp-chips");
    expect(html).toContain("keybar");
  });

  it("双入口:相册选图与拍照上传两钮并排在胶囊条左", () => {
    const html = render();
    expect(html).toContain("相册选图");
    expect(html).toContain("拍照上传");
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

  it("上传中(pending):原图即时 pending 卡 + 卡内「上传中」转圈遮罩,发送钮禁用", () => {
    const html = render({ draft: "hi", pending: "blob:p" });
    expect(html).toContain('class="shot pending"');
    expect(html).toContain('src="blob:p"');
    expect(html).toContain("shot-spin");
    expect(html).toContain("上传中</span>"); /* 卡内可见文案(非 aria 子串误命中) */
    expect(html).toContain('aria-label="发送" disabled'); /* 上传中禁发:防图未挂完先发 */
  });

  it("上传中重试钮禁用(错误条重试不经发送钮,UI 层 affordance;硬闸在 send 本体)", () => {
    expect(render({ sendErr: true, pending: "blob:p", shotBusy: true })).toContain('<button type="button" disabled="">重试</button>');
    expect(render({ sendErr: true })).toContain('<button type="button">重试</button>');
  });

  it("发送在途(sending)重试钮同样禁用(2026-10-03 二轮:affordance 与本体闸一致)", () => {
    expect(render({ sendErr: true, sending: true })).toContain('<button type="button" disabled="">重试</button>');
    /* 上传在途(pending)亦禁:canSend 三条件全对齐(二轮复查补) */
    expect(render({ sendErr: true, pending: "blob:p" })).toContain('<button type="button" disabled="">重试</button>');
  });

  it("挂图 + 上传中共存:既有缩略卡与 chips 照常,pending 卡尾随,发送钮禁用", () => {
    const html = render({ shots: [shot], pending: "blob:p" });
    expect(html).toContain("cp-chips");
    expect(html).toContain('class="shot pending"');
    expect(html).toContain('aria-label="发送" disabled');
  });

  it("错误条按图源分档:album 选图失败 / camera 拍照失败;原生明细(权限指引)优先展示", () => {
    expect(render({ shotErr: { kind: "album" } })).toContain("选图失败,请重试");
    expect(render({ shotErr: { kind: "camera" } })).toContain("拍照失败,请重试");
    expect(render({ shotErr: { kind: "camera", detail: "相机权限被拒,请在系统设置开启" } })).toContain(
      "相机权限被拒,请在系统设置开启",
    );
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

  it("面板五格:检查点/时间线不支持时置灰,快捷键格随键条开关点亮", () => {
    const on = renderToStaticMarkup(createElement(PlusPanel, panelBase));
    for (const label of ["相册", "切模型", "检查点", "时间线", "快捷键"]) expect(on).toContain(label);
    expect(on).toContain("cp-tile on");
    expect(on).not.toContain("disabled");
    const off = renderToStaticMarkup(createElement(PlusPanel, { ...panelBase, ckptReady: false, timelineReady: false, kbOn: false }));
    expect(off).toContain("disabled");
    expect(off).not.toContain("cp-tile on");
  });
});
