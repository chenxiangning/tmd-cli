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
import { ipc, type GitBranchInfo, type GitBranchList } from "@kernel/ipc";
import { gitErrorDisplay, isAuth } from "../gitError";
import { BranchContextMenu, type BranchMenuState } from "./BranchContextMenu";
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
import { requestWorktreeDialog } from "../panelStore";
import { useWorktreeBranchGroups } from "../worktree/useWorktreeBranchGroups";
import { LocalBranchGroups } from "./LocalBranchGroups";
import { useBranchActions } from "./useBranchActions";

interface Props {
  cwd: string;
  data: GitBranchList | null;
  currentName: string | undefined;
  /** 工作区有未提交变更(含 untracked):切换弹窗才提供「暂存并切换」次选 */
  dirty: boolean;
  loading: boolean;
  onMutation: () => void;
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
  /* 本地分支按检出归属三分区(数据面见 useWorktreeBranchGroups)。 */
  const { groups, zoned } = useWorktreeBranchGroups(cwd, locals);

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

  const { menuActions, confirmSwitch } = useBranchActions({
    cwd,
    dirty,
    currentName,
    run,
    setConfirm,
    setNameDialog,
    setCompare,
  });

  const createBranch = () => {
    const name = newName.trim();
    if (!name) return;
    run(() => ipc.gitCreateBranch(cwd, name).then(() => setNewName("")));
  };

  /** 切换/检出统一入口:应用内二次确认;脏工作区追加「暂存并切换」次选。 */
  const CreateCaret = createOpen ? CaretDown : CaretRight;

  return (
    <div className="flex h-full flex-col gap-1 overflow-y-auto p-2">
      <div className="flex items-center gap-1.5">
        <BranchSearchBox value={query} onChange={setQuery} />
        <button
          onClick={() => setCreateOpen((v) => !v)}
          aria-expanded={createOpen}
          title={t("新建分支")}
          className="rounded p-1.5 text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
        >
          <CreateCaret className="h-[0.75rem] w-[0.75rem]" />
        </button>
      </div>
      {createOpen && (
        <BranchCreateRow value={newName} onChange={setNewName} onSubmit={createBranch} busy={busy} />
      )}

      <GitOpBanner error={error} notice={notice} busy={busy} />

      <GroupLabel label={t("本地 ({n})", { n: locals.length })} />
      {zoned ? (
        <LocalBranchGroups
          groups={groups}
          handlers={{
            currentName,
            onCheckout: confirmSwitch,
            onDelete: (b, force) => run(() => ipc.gitDeleteBranch(cwd, b.name, force)),
            onMenu: (b, x, y) => setMenu({ x, y, branch: b }),
            onCreateTree: (branch) => requestWorktreeDialog({ branch, newBranch: false }),
          }}
        />
      ) : (
        locals.map((b) => (
          <BranchRow
            key={b.name}
            branch={b}
            isCurrent={b.name === currentName}
            onCheckout={() => confirmSwitch(b)}
            onDelete={(force) => run(() => ipc.gitDeleteBranch(cwd, b.name, force))}
            onMenu={(x, y) => setMenu({ x, y, branch: b })}
          />
        ))
      )}
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
