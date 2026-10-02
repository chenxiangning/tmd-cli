/**
 * SftpTree —— 远端文件树(懒展开,点击文件开编辑器 tab)。
 * 单一节点注册表(useRef Map<path, TreeNode>),展开即拉子级;
 * 右键弹操作菜单(下载/上传到目录/新建目录/重命名/删除)。
 * 行渲染拆至 SftpTreeRows.tsx,右键菜单拆至 SftpTreeMenu.tsx,
 * 共享类型与传输动作拆至 sftpTreeShared.ts(文件规模铁则)。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DownloadSimple, FolderSimple, ArrowClockwise, UploadSimple } from "@phosphor-icons/react";
import { ipc, type SftpEntry, type SftpTransferState } from "@kernel/ipc";
import { openTab } from "@kernel/tabs";
import { t } from "@kernel/i18n";
import { useSshTransfers } from "../state";
import {
  basenameOf,
  downloadNode,
  uploadPicked,
  type MenuState,
  type TreeNode,
} from "./sftpTreeShared";
import { TreeRows } from "./SftpTreeRows";
import { TreeMenu } from "./SftpTreeMenu";
import { TreeDialog, type TreeDialogAction, type TreeDialogState } from "./SftpTreeDialogs";

/** 远端编辑 tab 打开入口(tab.id = ssh://{sessionId}{path},kind = "ssh-file")。 */
function openRemoteFileTab(sessionId: string, entry: SftpEntry) {
  openTab(
    {
      id: `ssh://${sessionId}${entry.path}`,
      title: entry.name,
      path: entry.path,
      kind: "ssh-file",
      payload: { sessionId, path: entry.path, name: entry.name },
    },
    { refresh: true },
  );
}

export function SftpTree({ sessionId, connected }: { sessionId: string; connected: boolean }) {
  /* 根 Map 惰性初始化(挂载点 key=sessionId,本组件 prop 恒定无需 reset effect);
     getter 门面(useMemo 保恒等引用,回调依赖可稳定)保 nodes.current 恒非空类型,
     reload 走 clear() 原地复位。 */
  const nodesRef = useRef<Map<string, TreeNode> | null>(null);
  const nodes = useMemo<{ readonly current: Map<string, TreeNode> }>(
    () => ({
      get current() {
        nodesRef.current ??= new Map([
          [".", { path: ".", name: "/", kind: "dir", expanded: false, loading: false } satisfies TreeNode],
        ]);
        return nodesRef.current;
      },
    }),
    [],
  );
  const [, bump] = useState(0);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dialog, setDialog] = useState<TreeDialogState | null>(null);
  /* 操作失败内联红字(原生 alert 清零:与 ForwardSection 表单红字同形制)。 */
  const [error, setError] = useState<string | null>(null);
  const transfers = useSshTransfers(sessionId);
  const rerender = useCallback(() => bump((n) => n + 1), []);
  /* 传输动作返回错误文案(undefined = 成功/取消),统一落内联红字并顺手清旧错。 */
  const report = useCallback((err?: string) => setError(err ?? null), []);

  const nodeFor = useCallback(
    (path: string, name: string, kind: "dir" | "file"): TreeNode => {
      let node = nodes.current.get(path);
      if (!node) {
        node = { path, name, kind, expanded: false, loading: false };
        nodes.current.set(path, node);
      }
      node.name = name;
      node.kind = kind;
      return node;
    },
    [nodes],
  );

  const toggle = useCallback(
    async (node: TreeNode) => {
      if (node.kind !== "dir") return;
      if (node.children) {
        node.expanded = !node.expanded;
        rerender();
        return;
      }
      node.loading = true;
      setError(null);
      rerender();
      try {
        const entries = await ipc.sftpList(sessionId, node.path);
        node.children = entries;
        node.expanded = true;
      } catch (e) {
        node.children = [];
        setError(t("读取远端目录失败:{msg}", { msg: e instanceof Error ? e.message : String(e) }));
      } finally {
        node.loading = false;
        rerender();
      }
    },
    [sessionId, rerender],
  );

  const reloadAll = useCallback(() => {
    nodes.current.clear();
    nodeFor(".", "/", "dir");
    void toggle(nodes.current.get(".")!);
  }, [nodeFor, toggle, nodes]);

  useEffect(() => {
    if (!connected) return;
    void toggle(nodes.current.get(".")!);
  }, [connected, toggle, nodes]);

  const openFile = useCallback(
    (node: TreeNode) => {
      openRemoteFileTab(sessionId, {
        path: node.path,
        name: node.name,
        kind: "file",
        sizeBytes: 0,
        mtime: 0,
      });
    },
    [sessionId],
  );

  /* 传输动作具名 async handler(错误经 report 落内联红字,不再 JSX 内 .then)。 */
  const onUpload = useCallback(
    async () => report(await uploadPicked(sessionId, reloadAll)),
    [report, sessionId, reloadAll],
  );
  const onDownloadRoot = useCallback(
    async () => report(await downloadNode(sessionId, nodes.current.get(".")!, true)),
    [report, sessionId, nodes],
  );

  const active = transfers.filter((t) => t.status === "running" || t.status === "queued");

  return (
    <div className="ssh-section ssh-sftp">
      <div className="ssh-section-head">
        <FolderSimple size="0.75rem" aria-hidden />
        <span>{t("远端文件")}</span>
        <button
          type="button"
          className="ssh-icon-btn"
          title={t("刷新")}
          disabled={!connected}
          onClick={() => void reloadAll()}
        >
          <ArrowClockwise size="0.75rem" />
        </button>
        <button
          type="button"
          className="ssh-icon-btn"
          title={t("上传文件")}
          disabled={!connected}
          onClick={() => void onUpload()}
        >
          <UploadSimple size="0.75rem" />
        </button>
        <button
          type="button"
          className="ssh-icon-btn"
          title={t("下载根目录")}
          disabled={!connected}
          onClick={() => void onDownloadRoot()}
        >
          <DownloadSimple size="0.75rem" />
        </button>
      </div>
      {error ? (
        <div className="ssh-form-error" role="alert">
          {error}
        </div>
      ) : null}
      {!connected ? (
        <div className="ssh-section-empty">{t("连接建立后可浏览与编辑远端文件")}</div>
      ) : (
        <div className="ssh-sftp-tree">
          <TreeRows
            path="."
            depth={0}
            nodeFor={nodeFor}
            onToggle={toggle}
            onOpen={openFile}
            onMenu={(x, y, node) => setMenu({ x, y, node })}
          />
        </div>
      )}
      {active.length > 0 ? (
        <div className="ssh-transfer-list">
          {active.map((t) => (
            <TransferRow key={t.id} transfer={t} sessionId={sessionId} />
          ))}
        </div>
      ) : null}
      {menu ? (
        <TreeMenu
          sessionId={sessionId}
          state={menu}
          onClose={() => setMenu(null)}
          onMutate={reloadAll}
          onAction={(kind: TreeDialogAction) => setDialog({ kind, node: menu.node })}
          onError={setError}
        />
      ) : null}
      {dialog ? (
        <TreeDialog
          sessionId={sessionId}
          state={dialog}
          onMutate={reloadAll}
          onClose={() => setDialog(null)}
          onError={setError}
        />
      ) : null}
    </div>
  );
}

function TransferRow({ transfer, sessionId }: { transfer: SftpTransferState; sessionId: string }) {
  const total = transfer.bytesTotal || 1;
  const pct = Math.min(100, Math.round((transfer.bytesDone / total) * 100));
  return (
    <div className="ssh-transfer-row">
      <span className="ssh-transfer-label">
        {transfer.direction === "upload" ? "↑" : "↓"} {basenameOf(transfer.sourcePath)}
      </span>
      <div className="ssh-transfer-bar">
        <div className="ssh-transfer-fill" style={{ width: `${pct}%` }} />
      </div>
      <button
        type="button"
        className="ssh-icon-btn"
        title={t("取消")}
        onClick={() => void ipc.sftpTransferCancel(sessionId, transfer.id)}
      >
        ×
      </button>
    </div>
  );
}
