/**
 * Office 文档预览(doc/docx)—— 照抄 codemoss FileDocumentPreview.tsx
 * + useFilePreviewPayload 的 document 分支。
 *
 * docx:mammoth 转 HTML(2MB 闸)→ DOMPurify 消毒 → 标题大纲侧栏 + 文章视图;
 * doc(legacy):占位说明(与 codemoss 相同,mammoth 不支持二进制 doc)。
 * 与 codemoss 差异:i18n 硬编码中文;asset:// fetch 改 readBinaryFileBase64 字节通道;
 * DOMPurify 静态 import(本组件整体在懒 chunk 内,不拖累主包)。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { loadPreviewBytes } from "./previewBytes";
import {
  extractDocumentPreviewOutline,
  type PreviewOutlineItem,
} from "./previewOutline";
import { PreviewOutlineSidebar } from "../markdown/PreviewOutlineSidebar";

const MAX_DOCUMENT_PREVIEW_MB = 2;

type DocumentPayload =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "legacy-doc" }
  | { status: "ready"; html: string; warnings: string[]; byteLength: number };

/* mammoth ~250KB,静态 import 会拖进主 chunk;与编辑器/markdown 预览同款
   懒加载纪律 —— 真正打开 docx 才拉取。 */
async function loadDocxPayload(path: string): Promise<DocumentPayload> {
  const bytes = await loadPreviewBytes(path);
  if (bytes.byteLength > MAX_DOCUMENT_PREVIEW_MB * 1024 * 1024) {
    return {
      status: "error",
      message: `文档超过 ${MAX_DOCUMENT_PREVIEW_MB}MB,不支持预览`,
    };
  }
  const mammoth = await import("mammoth");
  const conversion = await mammoth.convertToHtml({
    arrayBuffer: bytes.slice().buffer,
  });
  return {
    status: "ready",
    html: DOMPurify.sanitize(conversion.value, {
      USE_PROFILES: { html: true },
    }),
    warnings: conversion.messages.map((item) => item.message),
    byteLength: bytes.byteLength,
  };
}

export function FileDocumentPreview({ path }: { path: string }) {
  const articleRef = useRef<HTMLElement | null>(null);
  const [payload, setPayload] = useState<DocumentPayload>({ status: "loading" });
  const [activeOutlineItemId, setActiveOutlineItemId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPayload({ status: "loading" });
    setActiveOutlineItemId(null);

    if (path.toLowerCase().endsWith(".doc")) {
      setPayload({ status: "legacy-doc" });
      return;
    }

    void (async () => {
      try {
        const nextPayload = await loadDocxPayload(path);
        if (!cancelled) {
          setPayload(nextPayload);
        }
      } catch (error) {
        if (!cancelled) {
          setPayload({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [path]);

  const outlinedDocument = useMemo(
    () =>
      payload.status === "ready"
        ? extractDocumentPreviewOutline(payload.html, "未命名")
        : { html: "", outline: [] },
    [payload],
  );

  useEffect(() => {
    setActiveOutlineItemId(null);
  }, [outlinedDocument.html]);

  if (payload.status === "loading") {
    return <div className="fvp-status">加载中…</div>;
  }

  if (payload.status === "error") {
    return <div className="fvp-status fvp-error">{payload.message}</div>;
  }

  if (payload.status === "legacy-doc") {
    return (
      <div className="fvp-preview-scroll">
        <div className="fvp-document-preview fvp-document-preview--fallback">
          <header className="fvp-preview-section-header">
            <strong>文档预览</strong>
          </header>
          <p>旧版 .doc 是二进制格式,暂不支持预览。</p>
          <p className="fvp-preview-budget-hint">
            可在系统中用对应应用打开,或转换为 .docx 后再预览。
          </p>
        </div>
      </div>
    );
  }

  const handleSelectOutlineItem = (item: PreviewOutlineItem) => {
    if (item.target.kind !== "html-anchor") {
      return;
    }
    const articleNode = articleRef.current;
    if (!articleNode) {
      return;
    }
    const anchorNode = articleNode.ownerDocument.getElementById(item.target.anchorId);
    if (!(anchorNode instanceof HTMLElement) || !articleNode.contains(anchorNode)) {
      return;
    }
    setActiveOutlineItemId(item.id);
    anchorNode.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <div className="fvp-preview-scroll">
      <div className="fvp-preview-shell">
        <PreviewOutlineSidebar
          items={outlinedDocument.outline}
          activeItemId={activeOutlineItemId}
          onSelectItem={handleSelectOutlineItem}
        />
        <div className="fvp-document-preview fvp-preview-main">
          <header className="fvp-preview-section-header">
            <strong>文档预览</strong>
            {payload.byteLength > 0 ? (
              <span>{`${Math.round(payload.byteLength / 1024)}KB`}</span>
            ) : null}
          </header>
          {payload.warnings.length > 0 ? (
            <div className="fvp-preview-budget-hint">
              {payload.warnings[0]}
            </div>
          ) : null}
          <article
            ref={articleRef}
            className="fvp-document-preview-article"
            dangerouslySetInnerHTML={{ __html: outlinedDocument.html }}
          />
        </div>
      </div>
    </div>
  );
}
