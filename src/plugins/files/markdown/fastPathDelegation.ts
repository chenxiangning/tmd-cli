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
import { openFileInTab } from "../openFile";
import { normalizeMarkdownAnchorKey } from "./markdownPreviewHelpers";
import { t } from "@kernel/i18n";

export type FastBlockMeta = { sourceFilePath: string | null };
export type FastComponents = Components & { __fastMeta?: FastBlockMeta };

export const fastPathCallbacks: { onImageFullscreen: ((image: { src: string; alt: string }) => void) | null } = {
  onImageFullscreen: null,
};

const copyRestoreTimers = new WeakMap<HTMLButtonElement, number>();

function handleFastCopyClick(button: HTMLButtonElement): void {
  const code = button.closest(".fvp-file-markdown-codeblock")?.querySelector("pre code");
  const value = code?.textContent ?? "";
  void navigator.clipboard
    .writeText(value)
    .then(() => {
      button.classList.add("is-copied");
      button.textContent = t("已复制");
      const previous = copyRestoreTimers.get(button);
      if (previous) {
        window.clearTimeout(previous);
      }
      copyRestoreTimers.set(
        button,
        window.setTimeout(() => {
          button.classList.remove("is-copied");
          button.textContent = t("复制");
        }, 1200),
      );
    })
    /* 剪贴板被拒(权限/无焦点)静默:与富路径 CodeBlockCopyButton 的 catch 早退同语义。 */
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
  const copyButton = target.closest<HTMLButtonElement>("button[data-md-copy]");
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
