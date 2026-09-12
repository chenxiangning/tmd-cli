/**
 * CodeMirror 编辑器入口 —— 薄 lazy 壳:重型 @uiw/@codemirror 全家桶(含
 * cmTheme/cmLanguage)只随 FileCodeEditorImpl 动态进入,拆独立 chunk,
 * 静态引用图零牵连;未开代码文件的会话首屏零加载。签名与原组件一致,
 * 三个消费方(files/ssh/cli-config)路径与用法均不变。
 */

import { lazy, Suspense } from "react";
import { t } from "@kernel/i18n";
import type { FileCodeEditorProps } from "./FileCodeEditorImpl";

const FileCodeEditorImpl = lazy(() => import("./FileCodeEditorImpl"));

export function FileCodeEditor(props: FileCodeEditorProps) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-xs text-(--tmd-fg-faint)">
          {t("加载中…")}
        </div>
      }
    >
      <FileCodeEditorImpl {...props} />
    </Suspense>
  );
}
