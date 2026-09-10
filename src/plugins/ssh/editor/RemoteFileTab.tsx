/**
 * RemoteFileTab —— 远端文件的编辑器 tab 内容(editorCenter.tabContent 挂载)。
 *
 * kind = "ssh-file" 的 tab:payload {sessionId, path, name}。
 * 读经 SFTP 分页(>200KB 提示只载头部);写回带 expectedMtime/expectedSize
 * 乐观并发,冲突弹覆盖确认;保存经 ssh.saveRemoteFile(⌘S)/工具条触发,脏标记走 kernel tabs.updateTab。
 */

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ipc, type SftpEntry } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { setActiveTab, updateTab, type EditorTab } from "@kernel/tabs";
import { saveRequestRef } from "./saveRequestRef";

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

export function RemoteFileTab({ tab }: { tab: EditorTab }) {
  const payload = tab.payload as { sessionId: string; path: string };
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
    updateTab(tab.id, { dirty });
  }, [dirty, tab]);

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
            ? t("远端已变更({time}, {size} 字节)", {
                time: new Date(current.mtime).toLocaleString(),
                size: current.sizeBytes,
              })
            : t("远端文件已被删除");
          if (window.confirm(t("{detail}。覆盖远端?", { detail }))) {
            await save(true);
          } else {
            setBanner(t("未保存:远端有变更"));
          }
          return;
        }
        setDoc((prev) =>
          prev ? { ...prev, entry: outcome.entry, truncated: false, sizeBytes: outcome.entry.sizeBytes } : prev,
        );
        setDirty(false);
      } catch (e) {
        setBanner(t("保存失败:{msg}", { msg: e instanceof Error ? e.message : String(e) }));
      } finally {
        setSaving(false);
      }
    },
    [payload, doc, saving, dirty],
  );

  /* 保存请求桥:⌘S 命令(ssh.saveRemoteFile)注册口经此触发最新 save;卸载即摘除,
     非远端文件 tab 下 when 不满足,键穿透。ref 转交在 effect 内(渲染期写禁)。 */
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
    saveRequestRef.current = () => void saveRef.current();
    return () => {
      saveRequestRef.current = null;
    };
  }, [save]);

  if (!payload) return null;
  if (!doc || !doc.loaded) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-(--tmd-fg-faint)">
        {t("读取远端文件…")}
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
          {doc.sizeBytes > 0 ? t("{n} 字节", { n: doc.sizeBytes }) : ""}
          {doc.truncated ? ` · ${t("仅载入头部 200KB")}` : ""}
        </span>
        {banner ? <span className="ssh-editor-banner">{banner}</span> : null}
        <button
          type="button"
          className="ssh-btn is-primary"
          disabled={!dirty || saving}
          onClick={() => void save()}
        >
          {saving ? t("保存中…") : t("保存")}
        </button>
      </div>
      {doc.truncated ? (
        <div className="ssh-editor-warn">
          {t("文件超过 200KB,仅载入头部;保存将整文件覆写,确认后再编辑。")}
        </div>
      ) : null}
      <div className="ssh-editor-body" role="presentation" onClick={() => setActiveTab(tab.id)}>
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-xs text-(--tmd-fg-faint)">
              {t("加载编辑器…")}
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
