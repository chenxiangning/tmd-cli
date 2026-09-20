/**
 * BranchView —— 分支视图:本地/远程分组 + 创建 / checkout / 删除。
 *
 * 切换/检出/删除/合并/变基的二次确认走应用内 GitConfirmDialog(WKWebView 下
 * window.confirm 可能不弹窗直接放行);脏工作区切换提供「暂存并切换」次选
 * (IDEA Smart Checkout 同款:stash -u → 切换 → pop,冲突时 stash 保留)。
 * 右键菜单(codemoss git graph 全 11 项同款):新建自 X / 签出并变基 / 与当前比较 /
 * 工作树差异 / 变基 / 合并 / 更新 / 获取 / 推送(开对话框)/ 重命名 / 删除。
 * merge/rebase 冲突留标准中间态透传,幕布终端接管收尾;远程行检出建同名本地分支
 * 并建跟踪;顶部搜索框按名称子串过滤两组,分组计数随过滤变化。
 */

import { useMemo, useState } from "react";
import { t } from "@kernel/i18n";
import { CaretDown, CaretRight } from "@phosphor-icons/react";
import { ipc, type GitBranchInfo, type GitBranchList, type GitRemoteOpReport } from "@kernel/ipc";
import { gitErrorDisplay, isAuth } from "../gitError";
import {
  BranchContextMenu,
  type BranchMenuActions,
  type BranchMenuState,
} from "./BranchContextMenu";
import { GitConfirmDialog, type GitConfirmState } from "./GitConfirmDialog";
import { BranchCompareModal, type BranchCompareRequest } from "./BranchCompareModal";
import { BranchNameDialog, type BranchNameDialogState } from "./BranchNameDialog";
import {
  BranchCreateRow,
  BranchRow,
  BranchSearchBox,
  GitOpBanner,
  GroupLabel,
} from "./BranchRow";
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
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [menu, setMenu] = useState<BranchMenuState | null>(null);
  const [confirm, setConfirm] = useState<GitConfirmState | null>(null);
  const [nameDialog, setNameDialog] = useState<BranchNameDialogState | null>(null);
  const [compare, setCompare] = useState<BranchCompareRequest | null>(null);
  const q = query.trim().toLowerCase();
  /* memo:busy/error/notice/menu 等状态翻转不再全表 O(n) 重滤(万级 refs 可感)。 */
  const { locals, remotes } = useMemo(() => {
    const f = (list: GitBranchInfo[]) => list.filter((b) => b.name.toLowerCase().includes(q));
    return { locals: f(data?.local ?? []), remotes: f(data?.remote ?? []) };
  }, [data, q]);

  const run = (action: () => Promise<unknown>, okNotice?: string | ((res: unknown) => string)) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    action().then(
      (res) => {
        setBusy(false);
        if (okNotice) setNotice(typeof okNotice === "string" ? okNotice : okNotice(res));
        onMutation();
      },
      (e: unknown) => {
        setBusy(false);
        /* auth 失败统一引导幕布终端(与对话框路径 useGitPanelRemote 同口径) */
        setError(isAuth(e) ? t("凭据需要交互,请到幕布终端执行 git 命令") : gitErrorDisplay(e));
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
      title: isRemote
        ? t("检出 {source} 为本地分支 {target}?", { source: b.name, target })
        : t("切换到分支 {branch}?", { branch: b.name }),
      detail: dirty
        ? t("工作区有未提交变动:「切换」会尝试直接携带(冲突将被拒绝);「暂存并切换」先入 stash、切换后自动恢复。")
        : undefined,
      confirmLabel: isRemote ? t("检出") : t("切换"),
      onConfirm: () =>
        run(
          () => (isRemote ? ipc.gitCheckoutRemote(cwd, b.name) : ipc.gitCheckout(cwd, b.name)),
          isRemote
            ? t("已检出到本地分支 {branch}", { branch: target })
            : t("已切换到 {branch}", { branch: b.name }),
        ),
      alt: dirty
        ? {
            label: isRemote ? t("暂存并检出") : t("暂存并切换"),
            onConfirm: () => {
              if (currentName) setSmartSwitchOrigin(cwd, currentName);
              run(
                () => ipc.gitSmartCheckout(cwd, b.name, isRemote),
                isRemote
                  ? t("已检出到本地分支 {branch}(改动已恢复)", { branch: target })
                  : t("已切换到 {branch}(改动已恢复)", { branch: b.name }),
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
        title: t("新建分支"),
        source: b.name,
        sourceLabel: t("基于分支:"),
        inputLabel: t("新分支名"),
        placeholder: t("新分支名..."),
        submitLabel: t("创建"),
        onSubmit: (name) =>
          run(
            () => ipc.gitCreateBranch(cwd, name, b.name),
            t("已基于 {base} 创建 {name}", { base: b.name, name }),
          ),
      }),
    checkoutRebase: (b) => {
      if (!currentName) return;
      setConfirm({
        title: t("签出并变基"),
        detail: t("确认签出 {branch} 并变基到 {onto} 吗?冲突时仓库留在变基中间态,可在幕布终端 continue/abort。", { branch: b.name, onto: currentName }),
        confirmLabel: t("签出并变基"),
        onConfirm: () => {
          const onto = currentName;
          run(
            () => ipc.gitCheckout(cwd, b.name).then(() => ipc.gitRebaseBranch(cwd, onto)),
            t("已签出 {branch} 并变基到 {onto}", { branch: b.name, onto }),
          );
        },
      });
    },
    compareWithCurrent: (b) => setCompare({ mode: "compare", target: b.name }),
    diffWithWorktree: (b) => setCompare({ mode: "worktree", branch: b.name }),
    rebaseCurrentOnto: (b) => {
      if (!currentName) return;
      setConfirm({
        title: t("当前分支变基"),
        detail: t("确认将当前分支 {current} 变基到 {branch} 吗?冲突时仓库留在变基中间态,可在幕布终端 continue/abort。", { current: currentName, branch: b.name }),
        confirmLabel: t("变基"),
        onConfirm: () =>
          run(
            () => ipc.gitRebaseBranch(cwd, b.name),
            t("已将 {current} 变基到 {branch}", { current: currentName, branch: b.name }),
          ),
      });
    },
    mergeIntoCurrent: (b) =>
      setConfirm({
        title: t("合并分支"),
        detail: t("确认将 {branch} 合并到当前分支吗?冲突时仓库留在合并中间态,可在幕布终端处理。", {
          branch: b.name,
        }),
        confirmLabel: t("合并"),
        onConfirm: () =>
          run(
            () => ipc.gitMergeBranch(cwd, b.name),
            t("已合并 {branch} 到 {current}", { branch: b.name, current: currentName ?? t("当前分支") }),
          ),
      }),
    pull: (b) =>
      run(() => ipc.gitPullPush(cwd, "pull", b.name), (r) =>
        (r as GitRemoteOpReport).upToDate
          ? t("{branch} 已是最新", { branch: b.name })
          : b.name === currentName
            ? t("已更新 {branch}", { branch: b.name })
            : t("已 fast-forward {branch}", { branch: b.name }),
      ),
    fetch: (b) =>
      run(() => ipc.gitPullPush(cwd, "fetch", b.name), (r) =>
        (r as GitRemoteOpReport).upToDate
          ? t("{branch} 的远端引用已是最新", { branch: b.name })
          : t("已获取 {branch} 的远端引用", { branch: b.name }),
      ),
    push: () => requestRemoteDialog("push"),
    rename: (b) =>
      setNameDialog({
        title: t("重命名分支"),
        source: b.name,
        sourceLabel: t("原分支名:"),
        inputLabel: t("新分支名"),
        initial: b.name,
        placeholder: t("请输入新的分支名称"),
        submitLabel: t("重命名"),
        onSubmit: (name) =>
          run(
            () => ipc.gitRenameBranch(cwd, b.name, name),
            t("已重命名 {from} 为 {to}", { from: b.name, to: name }),
          ),
      }),
    remove: (b) =>
      setConfirm({
        title: t("删除分支 {branch}?", { branch: b.name }),
        detail: t("未合并到当前分支的删除会被拒绝;强行删除请用行内删除按钮连点两次。"),
        confirmLabel: t("删除"),
        danger: true,
        onConfirm: () =>
          run(() => ipc.gitDeleteBranch(cwd, b.name, false), t("已删除 {branch}", { branch: b.name })),
      }),
  };
  const CreateCaret = createOpen ? CaretDown : CaretRight;

  return (
    <div className="flex h-full flex-col gap-1 overflow-y-auto p-2">
      <div className="flex items-center gap-1.5">
        <BranchSearchBox value={query} onChange={setQuery} />
        <button
          onClick={() => setCreateOpen((v) => !v)}
          aria-expanded={createOpen}
          title={t("新建分支")}
          className="rounded p-1.5 text-(--tmd-fg-muted) hover:bg-(--tmd-bg-elevated) hover:text-(--tmd-fg)"
        >
          <CreateCaret className="h-[0.75rem] w-[0.75rem]" />
        </button>
      </div>
      {createOpen && (
        <BranchCreateRow value={newName} onChange={setNewName} onSubmit={createBranch} busy={busy} />
      )}

      <GitOpBanner error={error} notice={notice} busy={busy} />

      <GroupLabel label={t("本地 ({n})", { n: locals.length })} />
      {locals.map((b) => (
        <BranchRow
          key={b.name}
          branch={b}
          isCurrent={b.name === currentName}
          onCheckout={() => confirmSwitch(b)}
          onDelete={(force) => run(() => ipc.gitDeleteBranch(cwd, b.name, force))}
          onMenu={(x, y) => setMenu({ x, y, branch: b })}
        />
      ))}
      {loading && !data && <div className="px-2 py-1 text-(--tmd-fg-faint)">{t("加载中…")}</div>}

      <GroupLabel label={t("远程 ({n})", { n: remotes.length })} />
      {remotes.map((b) => (
        <BranchRow
          key={b.name}
          branch={b}
          isCurrent={false}
          onCheckout={() => confirmSwitch(b)}
          onMenu={(x, y) => setMenu({ x, y, branch: b })}
        />
      ))}
      {q !== "" && locals.length === 0 && remotes.length === 0 && (
        <div className="px-2 py-1 text-(--tmd-fg-faint)">{t("没有匹配的分支")}</div>
      )}

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
