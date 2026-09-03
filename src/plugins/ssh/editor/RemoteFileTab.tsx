/**
 * RemoteFileTab —— 远端文件的编辑器 tab 内容(editorCenter.tabContent 挂载)。
 *
 * kind = "ssh-file" 的 tab:payload {sessionId, path, name}。
 * 读经 SFTP 分页(>200KB 提示只载头部);写回带 expectedMtime/expectedSize
 * 乐观并发,冲突弹覆盖确认;⌘S/工具条保存,脏标记走 kernel tabs.updateTab。
 */

import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { ipc, type SftpEntry } from "@kernel/ipc";
import { setActiveTab, updateTab, useEditorTabs } from "@kernel/tabs";

/* CodeMirror 全家按需拆包(files 插件同款):首个 ssh-file tab 才拉 chunk;
   与 files 的 lazy import 指向同一模块,chunk 共享。 */
const Editor = lazy(() =>
  import("@kernel/cmEditor/FileCodeEditor").then((m) => ({ default: m.FileCodeEditor })),
);

interface RemoteDoc {
  content: string;
  entry: SftpEntry;
  truncated: boolean;
  sizeBytes: number;
  loaded: boolean;
  error?: string;
}

/** 编辑器明暗跟随 <html data-theme>。 */
function useDarkTheme(): boolean {
  const [dark, setDark] = useState(() =>
    document.documentElement.dataset.theme?.includes("light") === false,
  );
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setDark(document.documentElement.dataset.theme?.includes("light") === false),
    );
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

export function RemoteFileTab() {
  const { activeId, tabs } = useEditorTabs();
  const active = tabs.find((t) => t.id === activeId);
  const payload =
    active?.kind === "ssh-file" ? (active.payload as { sessionId: string; path: string }) : null;
  const [doc, setDoc] = useState<RemoteDoc | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const dark = useDarkTheme();

  /* 文件切换:整树重建(key 驱动),脏标记与横幅一并复位。 */
  useEffect(() => {
    setDoc(null);
    setDirty(false);
    setBanner(null);
    if (!payload) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await ipc.sftpReadText(payload.sessionId, payload.path);
        if (cancelled) return;
        setDoc({
          content: result.content,
          entry: result.entry,
          truncated: result.truncated,
          sizeBytes: result.sizeBytes,
          loaded: true,
        });
      } catch (e) {
        if (!cancelled) {
          setDoc({
            content: "",
            entry: {
              path: payload.path,
              name: "",
              kind: "file",
              sizeBytes: 0,
              mtime: 0,
            },
            truncated: false,
            sizeBytes: 0,
            loaded: true,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [payload?.sessionId, payload?.path]);

  useEffect(() => {
    if (active) updateTab(active.id, { dirty });
  }, [dirty, active]);

  const save = useCallback(
    async (force = false) => {
      if (!payload || !doc || saving || !dirty) return;
      setSaving(true);
      setBanner(null);
      try {
        const outcome = await ipc.sftpWriteText(
          payload.sessionId,
          payload.path,
          doc.content,
          force ? undefined : doc.entry.mtime || undefined,
          force ? undefined : doc.entry.sizeBytes,
        );
        if (outcome.action === "conflict") {
          const current = outcome.entry;
          const detail = current
            ? `远端已变更(${new Date(current.mtime).toLocaleString()}, ${current.sizeBytes} 字节)`
            : "远端文件已被删除";
          if (window.confirm(`${detail}。覆盖远端?`)) {
            await save(true);
          } else {
            setBanner("未保存:远端有变更");
          }
          return;
        }
        setDoc((prev) =>
          prev ? { ...prev, entry: outcome.entry, truncated: false, sizeBytes: outcome.entry.sizeBytes } : prev,
        );
        setDirty(false);
      } catch (e) {
        setBanner(`保存失败:${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setSaving(false);
      }
    },
    [payload, doc, saving, dirty],
  );

  /* ⌘S 窗口级捕获(与 files 编辑器同款纪律:编辑器内键位之外的全局面)。 */
  useEffect(() => {
    if (!payload) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [payload, save]);

  if (!active) return null;
  if (!payload) return null;
  if (!doc || !doc.loaded) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-(--tmd-fg-faint)">
        读取远端文件…
      </div>
    );
  }
  if (doc.error) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-red-400">
        ⚠ {doc.error}
      </div>
    );
  }

  return (
    <div className="ssh-editor">
      <div className="ssh-editor-bar">
        <span className="ssh-editor-path" title={payload.path}>
          {payload.path}
        </span>
        <span className="ssh-editor-meta">
          {doc.sizeBytes > 0 ? `${doc.sizeBytes} 字节` : ""}
          {doc.truncated ? " · 仅载入头部 200KB" : ""}
        </span>
        {banner ? <span className="ssh-editor-banner">{banner}</span> : null}
        <button
          type="button"
          className="ssh-btn is-primary"
          disabled={!dirty || saving}
          onClick={() => void save()}
        >
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
      {doc.truncated ? (
        <div className="ssh-editor-warn">
          文件超过 200KB,仅载入头部;保存将整文件覆写,确认后再编辑。
        </div>
      ) : null}
      <div className="ssh-editor-body" onClick={() => setActiveTab(active.id)}>
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-xs text-(--tmd-fg-faint)">
              加载编辑器…
            </div>
          }
        >
          <Editor
            key={`${payload.sessionId}:${payload.path}`}
            path={payload.path}
            value={doc.content}
            dark={dark}
            onChange={(value) => {
              if (value === doc.content) return;
              setDoc((prev) => (prev ? { ...prev, content: value } : prev));
              setDirty(value !== doc.content);
            }}
            onSave={() => void save()}
          />
        </Suspense>
      </div>
    </div>
  );
}
