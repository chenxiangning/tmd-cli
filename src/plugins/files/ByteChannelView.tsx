/**
 * 字节通道型渲染(图片/PDF/文档/二进制表格):从 FileTabContent 拆出(300 行铁则)。
 * 分派自取数据,不走 fileCache 文本管线;字节态右键菜单仅 路径/访达 两项。
 */

import { Suspense, lazy, useRef } from "react";
import type { EditorView } from "@codemirror/view";
import { retryImport } from "@kernel/lazyImport";
import { useFileDetailMenu } from "./useFileDetailMenu";
import { LOADING } from "./FileCenterView";
import { FileImagePreview } from "./render/FileImagePreview";
import { FileBinaryUnsupported } from "./render/FileBinaryUnsupported";
import type { FileRenderKind } from "./render/renderProfile";

const FilePdfPreview = lazy(retryImport(() =>
  import("./render/FilePdfPreview").then((m) => ({ default: m.FilePdfPreview })),
));
const FileTabularPreview = lazy(retryImport(() => import("./render/FileTabularPreview").then((m) => ({ default: m.FileTabularPreview }))));
const FileDocumentPreview = lazy(retryImport(() => import("./render/FileDocumentPreview").then((m) => ({ default: m.FileDocumentPreview }))));

/** 字节通道渲染分派(图片/二进制占位自取数据;PDF/文档/二进制表格走字节管线)。 */
export function ByteChannelView({ path, kind }: { path: string; kind: FileRenderKind }) {
  /* 字节态菜单仅 路径/访达 两项;display:contents 包装零布局影响。 */
  const viewRef = useRef<EditorView | null>(null);
  const { detailMenuProps, detailMenu } = useFileDetailMenu({ variant: "byte", path, viewRef });
  return (
    <>
      <div className="contents" {...detailMenuProps}>
        {kind === "image" ? <FileImagePreview path={path} /> : null}
        {kind === "binary-unsupported" ? <FileBinaryUnsupported path={path} /> : null}
        {kind === "pdf" ? (
          <Suspense fallback={<LOADING />}>
            <FilePdfPreview path={path} />
          </Suspense>
        ) : null}
        {kind === "document" ? (
          <Suspense fallback={<LOADING />}>
            <FileDocumentPreview path={path} />
          </Suspense>
        ) : null}
        {kind === "tabular" ? (
          <Suspense fallback={<LOADING />}>
            <FileTabularPreview path={path} text={null} />
          </Suspense>
        ) : null}
      </div>
      {detailMenu}
    </>
  );
}

