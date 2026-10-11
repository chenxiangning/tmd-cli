/**
 * 工作台 · 文档编辑面(markdown 源编辑 + 渲染预览两态,segmented 切换):
 * 编辑 = CodeMirror 6 markdown(懒载,与 kernel/cmEditor 同拆包纪律);
 * 预览 = session-viewer MarkdownBody(跨插件复用先例:journal/articleBody、
 * structured-session/sessionTab)。落盘恒为 markdown 源,预览渲染当前草稿
 * (含未保存修改),保存语义仍归 DrawerDocsTab(保存钮 / Mod-s)。
 */

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { Extension } from "@codemirror/state";
import { t } from "@kernel/i18n";
import { getSettingsState } from "@kernel/settings";
import { retryImport } from "@kernel/lazyImport";
import { useDarkTheme } from "@kernel/theme";
import { loadCmLanguage } from "@kernel/cmEditor/cmLanguage";
import { loadCmTheme } from "@kernel/cmEditor/cmTheme";

/* 重型依赖双双按需进 chunk:CodeMirror 全家与 md 渲染管线只在首次编辑/预览时加载。 */
const CodeMirror = lazy(retryImport(() => import("@uiw/react-codemirror").then((m) => ({ default: m.default }))));
const MarkdownBody = lazy(retryImport(() =>
  import("@plugins/session-viewer/markdownBody").then((m) => ({ default: m.MarkdownBody })),
));

type DocEditorMode = "edit" | "preview";

export function DocEditor({ value, onChange, onSave }: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const dark = useDarkTheme();
  /* 初始视图按设置(默认预览);空内容恒进编辑 —— 空白预览无处落笔。 */
  const [mode, setMode] = useState<DocEditorMode>(() =>
    value.trim().length === 0 || getSettingsState().settings.workbenchDocDefaultMode === "edit" ? "edit" : "preview",
  );
  const [exts, setExts] = useState<Extension[]>([]);
  /* 键位经 ref 取最新回调:扩展只随主题装载一次,不随父级重渲重建。 */
  const saveRef = useRef(onSave);
  useEffect(() => { saveRef.current = onSave; });

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [lang, theme, view, commands] = await Promise.all([
        loadCmLanguage("md"),
        loadCmTheme(dark),
        import("@codemirror/view"),
        import("@codemirror/commands"),
      ]);
      if (!alive) return;
      const saveKeys: Extension = view.keymap.of([
        { key: "Mod-s", run: () => { saveRef.current(); return true; } },
        commands.indentWithTab,
      ]);
      setExts([...lang, ...theme, view.EditorView.lineWrapping, saveKeys]);
    })().catch(() => undefined /* 失败降级纯文本编辑面 */);
    return () => { alive = false; };
  }, [dark]);

  return (
    <div className="wb-doc-editor-shell">
      <div className="wb-doc-editor-toolbar">
        <div className="segmented" role="radiogroup" aria-label={t("文档编辑视图")}>
          <button
            type="button" role="radio" aria-checked={mode === "edit"}
            className={`segment ${mode === "edit" ? "is-active" : ""}`}
            onClick={() => setMode("edit")}
          >{t("编辑")}</button>
          <button
            type="button" role="radio" aria-checked={mode === "preview"}
            className={`segment ${mode === "preview" ? "is-active" : ""}`}
            onClick={() => setMode("preview")}
          >{t("预览")}</button>
        </div>
      </div>
      {mode === "edit" ? (
        <Suspense fallback={null}>
          <CodeMirror
            className="wb-doc-cm"
            value={value}
            theme="none" /* 配色全走 loadCmTheme(--tmd token);关掉 @uiw 内置明暗底色,循 FileCodeEditorImpl */
            extensions={exts}
            placeholder={t("支持 markdown;附件/图片在下方上传。")}
            onChange={onChange}
          />
        </Suspense>
      ) : (
        <div className="wb-doc-preview-body">
          <Suspense fallback={null}>
            <MarkdownBody>{value}</MarkdownBody>
          </Suspense>
        </div>
      )}
    </div>
  );
}
