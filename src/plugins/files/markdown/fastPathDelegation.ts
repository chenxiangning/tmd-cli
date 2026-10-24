/**
 * 快路径容器的事件委托 —— 自 useMarkdownComponents.tsx 拆出(文件规模铁则)。
 *
 * 快路径块(fastPath.ts)是 innerHTML 直塞,没有 React 组件树;链接/图片/代码块
 * 复制全部由容器 onClick 统一分发(yn 的 VIEW_ELEMENT_CLICK hook 代理同思路)。
 * onImageFullscreen 是 hook 闭包态,经模块级 ref 桥传入(latest-ref 范式;
 * BlockMarkdown 不便新增 prop——FileMarkdownPreview 的调用面保持零改动)。
 */

import type { Components } from "react-markdown";
import { openExternalUrl } from "@kernel/ipc";
import { openFileInTab } from "@kernel/fileTabs";
import { copyText } from "@kernel/clipboard";
import { normalizeMarkdownAnchorKey } from "./markdownPreviewHelpers";
import { CHECK_ICON_SVG, COPY_ICON_SVG } from "./fastPath";
import { tableToMarkdown } from "./tableSource";

export type FastBlockMeta = { sourceFilePath: string | null };
export type FastComponents = Components & { __fastMeta?: FastBlockMeta };

export const fastPathCallbacks: { onImageFullscreen: ((image: { src: string; alt: string }) => void) | null } = {
  onImageFullscreen: null,
};

const copyRestoreTimers = new WeakMap<HTMLButtonElement, number>();

/** 复制取值:代码块取 pre code 文本;表格块从渲染 DOM 现构 GFM 源(tableSource)。 */
function resolveCopyValue(button: HTMLButtonElement): string {
  if (button.getAttribute("data-md-table-copy") !== null) {
    const table = button.closest(".fvp-file-markdown-table-block")?.querySelector("table");
    return table ? tableToMarkdown(table) : "";
  }
  return button.closest(".fvp-file-markdown-codeblock")?.querySelector("pre code")?.textContent ?? "";
}

function handleFastCopyClick(button: HTMLButtonElement): void {
  const value = resolveCopyValue(button);
  /* copyText 而非裸 async clipboard:macOS WKWebView 对 async 写有 focus/activation
     苛刻校验常拒(7b13952b 同因),execCommand 同步腿恰在点击手势内;与富路径
     CodeBlockCopyButton 同原语。双路皆败才抛,此处静默吞(同富路径 catch 早退)。 */
  void copyText(value)
    .then(() => {
      button.classList.add("is-copied");
      /* 反馈同富路径:Copy 图标换 Check,1.2s 后还原(纯 icon,防 24×24 盒内文字折行)。 */
      button.innerHTML = CHECK_ICON_SVG;
      const previous = copyRestoreTimers.get(button);
      if (previous) {
        window.clearTimeout(previous);
      }
      copyRestoreTimers.set(
        button,
        window.setTimeout(() => {
          button.classList.remove("is-copied");
          button.innerHTML = COPY_ICON_SVG;
        }, 1200),
      );
    })
    .catch(() => undefined);
}

/** 快路径锚点跳转:在预览滚动容器内按标题文本宽松匹配(同富路径 handleAnchorNavigate 语义)。 */
function revealFastAnchor(container: HTMLElement | null, anchor: string): void {
  if (!container || !anchor) {
    return;
  }
  const wanted = normalizeMarkdownAnchorKey(anchor);
  if (!wanted) {
    return;
  }
  const headings = container.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6");
  for (const heading of headings) {
    if (normalizeMarkdownAnchorKey(heading.textContent ?? "") === wanted) {
      heading.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
  }
}

export function handleFastBlockClick(event: globalThis.MouseEvent): void {
  const target = event.target as HTMLElement;
  /* 复制路由:代码块 > 表格块(两种按钮都不在链接分支之前放行)。 */
  const copyButton =
    target.closest<HTMLButtonElement>("button[data-md-copy]") ??
    target.closest<HTMLButtonElement>("button[data-md-table-copy]");
  if (copyButton) {
    event.stopPropagation();
    handleFastCopyClick(copyButton);
    return;
  }
  const image = target.closest<HTMLImageElement>("img[data-md-img]");
  if (image) {
    fastPathCallbacks.onImageFullscreen?.({
      src: image.dataset.mdImg ?? "",
      alt: image.getAttribute("alt") ?? "image",
    });
    return;
  }
  const anchor = target.closest<HTMLAnchorElement>("a[data-md-link]");
  if (!anchor) {
    return;
  }
  /* 与富路径 handleAnchorClick 同规则:一切 md 内链接先拦默认导航。 */
  event.preventDefault();
  event.stopPropagation();
  const kind = anchor.dataset.mdLink;
  if (kind === "external") {
    const href = anchor.getAttribute("href") ?? "";
    if (href.startsWith("//")) {
      void openExternalUrl(`https:${href}`);
    } else {
      void openExternalUrl(href);
    }
    return;
  }
  if (kind === "file") {
    const path = anchor.dataset.mdPath;
    if (path) {
      openFileInTab(path);
    }
    return;
  }
  if (kind === "anchor") {
    revealFastAnchor(
      (event.currentTarget as HTMLElement).closest(".fvp-markdown-preview-scroll"),
      anchor.dataset.mdAnchor ?? "",
    );
  }
}
