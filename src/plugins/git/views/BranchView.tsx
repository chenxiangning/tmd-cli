/**
 * BranchView —— 分支视图:本地/远程分组 + 创建 / checkout / 删除。
 *
 * 切换/检出/删除/合并/变基/签出并变基的二次确认走应用内 GitConfirmDialog
 * (window.confirm 在 Tauri WKWebView 下可能不弹窗直接放行,易失操作一律不用它);
 * 脏工作区切换提供「暂存并切换」次选(复刻 IDEA Smart Checkout:stash -u →
 * 切换 → pop;pop 冲突时 stash 保留、文件标冲突)。
 * 右键菜单(codemoss git graph 全 11 项同款):新建自 X / 签出并变基 / 与当前比较 /
 * 工作树差异 / 变基 / 合并 / 更新 / 获取 / 推送(开对话框)/ 重命名 / 删除。
 * checkout 脏工作区冲突:libgit2 safe 模式拒绝 → 后端给出「先提交或暂存」引导,不擅自 force。
 * merge/rebase 冲突:git CLI 留标准中间态(E_SHELL 透传),幕布终端可接管收尾。
 * 远程行检出:建同名本地分支并建跟踪(checkout_remote),本地同名已存在由后端拒绝。
 */

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { ipc, type GitBranchInfo, type GitBranchList } from "@kernel/ipc";
import { gitErrorDisplay } from "../gitError";
import {
  BranchContextMenu,
  type BranchMenuActions,
  type BranchMenuState,
} from "./BranchContextMenu";
import { GitConfirmDialog, type GitConfirmState } from "./GitConfirmDialog";
import { BranchCompareModal, type BranchCompareRequest } from "./BranchCompareModal";
import { BranchNameDialog, type BranchNameDialogState } from "./BranchNameDialog";
import { BranchRow, GroupLabel } from "./BranchRow";
import { requestRemoteDialog, setSmartSwitchOrigin } from "../panelStore";

interface Props {
  cwd: string;
  data: GitBranchList | null;
  currentName: string | undefined;
  /** 工作区有未提交变更(含 untracked):切换弹窗才提供「暂存并切换」次选 */
  dirty: boolean;
  loading: boolean;
  onMutation: () => void;
}

/** 远程分支名剥首个远端段:origin/feat/x → feat/x(与后端 checkout_remote 同规则)。 */
function localNameOf(remoteBranch: string): string {
  return remoteBranch.replace(/^[^/]+\//, "");
}

export function BranchView({ cwd, data, loading, currentName, dirty, onMutation }: Props) {
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [menu, setMenu] = useState<BranchMenuState | null>(null);
  const [confirm, setConfirm] = useState<GitConfirmState | null>(null);
  const [nameDialog, setNameDialog] = useState<BranchNameDialogState | null>(null);
  const [compare, setCompare] = useState<BranchCompareRequest | null>(null);

  const run = (action: () => Promise<unknown>, okNotice?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    action().then(
      () => {
        setBusy(false);
        if (okNotice) setNotice(okNotice);
        onMutation();
      },
      (e: unknown) => {
        setBusy(false);
        setError(gitErrorDisplay(e));
      },
    );
  };

  const createBranch = () => {
    const name = newName.trim();
    if (!name) return;
    run(() => ipc.gitCreateBranch(cwd, name).then(() => setNewName("")));
  };

  /** 切换/检出统一入口:应用内二次确认;脏工作区追加「暂存并切换」次选。 */
  const confirmSwitch = (b: GitBranchInfo) => {
    const target = b.isRemote ? localNameOf(b.name) : b.name;
    const isRemote = b.isRemote;
    setConfirm({
      title: isRemote ? `检出 ${b.name} 为本地分支 ${target}?` : `切换到分支 ${b.name}?`,
      detail: dirty
        ? "工作区有未提交变动:「切换」会尝试直接携带(冲突将被拒绝);「暂存并切换」先入 stash、切换后自动恢复。"
        : undefined,
      confirmLabel: isRemote ? "检出" : "切换",
      onConfirm: () =>
        run(
          () => (isRemote ? ipc.gitCheckoutRemote(cwd, b.name) : ipc.gitCheckout(cwd, b.name)),
          isRemote ? `已检出到本地分支 ${target}` : `已切换到 ${b.name}`,
        ),
      alt: dirty
        ? {
            label: isRemote ? "暂存并检出" : "暂存并切换",
            onConfirm: () => {
              if (currentName) setSmartSwitchOrigin(cwd, currentName);
              run(
                () => ipc.gitSmartCheckout(cwd, b.name, isRemote),
                isRemote
                  ? `已检出到本地分支 ${target}(改动已恢复)`
                  : `已切换到 ${b.name}(改动已恢复)`,
              );
            },
          }
        : undefined,
    });
  };

  const menuActions: BranchMenuActions = {
    checkout: confirmSwitch,
    createFrom: (b) =>
      setNameDialog({
        title: "新建分支",
        source: b.name,
        sourceLabel: "基于分支:",
        inputLabel: "新分支名",
        placeholder: "新分支名...",
        submitLabel: "创建",
        onSubmit: (name) =>
          run(() => ipc.gitCreateBranch(cwd, name, b.name), `已基于 ${b.name} 创建 ${name}`),
      }),
    checkoutRebase: (b) => {
      if (!currentName) return;
      setConfirm({
        title: "签出并变基",
        detail: `确认签出 ${b.name} 并变基到 ${currentName} 吗?冲突时仓库留在变基中间态,可在幕布终端 continue/abort。`,
        confirmLabel: "签出并变基",
        onConfirm: () => {
          const onto = currentName;
          run(
            () => ipc.gitCheckout(cwd, b.name).then(() => ipc.gitRebaseBranch(cwd, onto)),
            `已签出 ${b.name} 并变基到 ${onto}`,
          );
        },
      });
    },
    compareWithCurrent: (b) => setCompare({ mode: "compare", target: b.name }),
    diffWithWorktree: (b) => setCompare({ mode: "worktree", branch: b.name }),
    rebaseCurrentOnto: (b) => {
      if (!currentName) return;
      setConfirm({
        title: "当前分支变基",
        detail: `确认将当前分支 ${currentName} 变基到 ${b.name} 吗?冲突时仓库留在变基中间态,可在幕布终端 continue/abort。`,
        confirmLabel: "变基",
        onConfirm: () =>
          run(() => ipc.gitRebaseBranch(cwd, b.name), `已将 ${currentName} 变基到 ${b.name}`),
      });
    },
    mergeIntoCurrent: (b) =>
      setConfirm({
        title: "合并分支",
        detail: `确认将 ${b.name} 合并到当前分支吗?冲突时仓库留在合并中间态,可在幕布终端处理。`,
        confirmLabel: "合并",
        onConfirm: () =>
          run(
            () => ipc.gitMergeBranch(cwd, b.name),
            `已合并 ${b.name} 到 ${currentName ?? "当前分支"}`,
          ),
      }),
    pull: (b) =>
      run(
        () => ipc.gitPullPush(cwd, "pull", b.name),
        b.name === currentName ? `已更新 ${b.name}` : `已 fast-forward ${b.name}`,
      ),
    fetch: (b) => run(() => ipc.gitPullPush(cwd, "fetch", b.name), `已获取 ${b.name} 的远端引用`),
    push: () => requestRemoteDialog("push"),
    rename: (b) =>
      setNameDialog({
        title: "重命名分支",
        source: b.name,
        sourceLabel: "原分支名:",
        inputLabel: "新分支名",
        initial: b.name,
        placeholder: "请输入新的分支名称",
        submitLabel: "重命名",
        onSubmit: (name) =>
          run(() => ipc.gitRenameBranch(cwd, b.name, name), `已重命名 ${b.name} 为 ${name}`),
      }),
    remove: (b) =>
      setConfirm({
        title: `删除分支 ${b.name}?`,
        detail: "未合并到当前分支的删除会被拒绝;强行删除请用行内删除按钮连点两次。",
        confirmLabel: "删除",
        danger: true,
        onConfirm: () => run(() => ipc.gitDeleteBranch(cwd, b.name, false), `已删除 ${b.name}`),
      }),
  };

  return (
    <div className="flex h-full flex-col gap-1 overflow-y-auto p-2">
      <div className="flex items-center gap-1.5">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && createBranch()}
          placeholder="新分支名..."
          className="min-w-0 flex-1 rounded border border-(--tmd-border) bg-(--tmd-bg-input) px-2 py-1 text-xs outline-none focus:border-(--tmd-accent)"
        />
        <button
          onClick={createBranch}
          disabled={!newName.trim() || busy}
          title="基于当前 HEAD 创建"
          className="rounded bg-(--tmd-accent) p-1.5 text-(--tmd-accent-fg) disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {error && (
        <div className="rounded bg-(--tmd-bg-sunken) px-2 py-1 text-(--tmd-diff-removed)">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded bg-(--tmd-bg-elevated) px-2 py-1 text-(--tmd-fg-muted)">
          {notice}
        </div>
      )}
      {busy && (
        <div className="flex items-center gap-1.5 text-(--tmd-fg-faint)">
          <Loader2 className="h-3 w-3 animate-spin" /> 执行中…
        </div>
      )}

      <GroupLabel label={`本地 (${data?.local.length ?? 0})`} />
      {data?.local.map((b) => (
        <BranchRow
          key={b.name}
          branch={b}
          isCurrent={b.name === currentName}
          onCheckout={() => confirmSwitch(b)}
          onDelete={(force) => run(() => ipc.gitDeleteBranch(cwd, b.name, force))}
          onMenu={(x, y) => setMenu({ x, y, branch: b })}
        />
      ))}
      {loading && !data && <div className="px-2 py-1 text-(--tmd-fg-faint)">加载中…</div>}

      <GroupLabel label={`远程 (${data?.remote.length ?? 0})`} />
      {data?.remote.map((b) => (
        <BranchRow
          key={b.name}
          branch={b}
          isCurrent={false}
          onCheckout={() => confirmSwitch(b)}
          onMenu={(x, y) => setMenu({ x, y, branch: b })}
        />
      ))}

      {menu && (
        <BranchContextMenu
          state={menu}
          currentName={currentName}
          busy={busy}
          actions={menuActions}
          onClose={() => setMenu(null)}
        />
      )}

      {confirm && <GitConfirmDialog state={confirm} onClose={() => setConfirm(null)} />}
      {nameDialog && (
        <BranchNameDialog state={nameDialog} onClose={() => setNameDialog(null)} />
      )}
      {compare && (
        <BranchCompareModal
          cwd={cwd}
          currentName={currentName}
          request={compare}
          onClose={() => setCompare(null)}
        />
      )}
    </div>
  );
}

