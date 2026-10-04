/**
 * Git 面板 —— 手机复刻桌面 git 插件主面板(大仙 2026-09-24 拍板):
 * 状态摘要(分支 + ±行数 + ⇅ahead/behind)+ 差异/分支/历史三视图 +
 * 远端操作(刷新/获取/拉取/推送/创建 PR)。契约类型全部来自
 * @kernel/gitContract(serde camelCase 对齐 Rust);命令面 = conn.rs
 * AppDevice 白名单 git_* 子集,读多写少,动作全部显式点按。
 * 工作区 = 顶部 chips(最近选择 localStorage 持久化)。
 */
import { invoke } from "@kernel/transport";
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@kernel/i18n";
import type {
  GitAheadBehind,
  GitBranchList,
  GitDiffStatus,
  GitLogEntry,
  GitRemoteOpReport,
  GitTotals,
} from "@kernel/gitContract";
import { useMobile } from "./shared";
import {
  fetchCommitFiles,
  fetchFilePatch,
  fetchGitLogPage,
  loadGitSnapshot,
  LOG_LIMIT,
  mergeLogPage,
  opReportText,
  type CommitFilesState,
  type GitView,
  type RemoteOp,
} from "./gitModel";
import type { PrSheetState } from "./GitSheets";
import { DiffView, GitHeader, GitOverlays, LogView } from "./GitViews";

const WS_KEY = "tmd.git.ws.v1";

export function GitScreen(props: { onBack: () => void }) {
  const { workspaces } = useMobile();
  const [wsId, setWsId] = useState<string>(() => {
    try {
      return localStorage.getItem(WS_KEY) || "";
    } catch {
      return "";
    }
  });
  const ws = workspaces.find((w) => w.id === wsId) ?? workspaces[0];
  const cwd = ws?.root ?? "";
  const [view, setView] = useState<GitView>("diff");
  const [status, setStatus] = useState<GitDiffStatus | null>(null);
  const [totals, setTotals] = useState<GitTotals | null>(null);
  const [ab, setAb] = useState<GitAheadBehind | null>(null);
  const [branches, setBranches] = useState<GitBranchList | null>(null);
  const [log, setLog] = useState<GitLogEntry[] | null>(null);
  const [logDone, setLogDone] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [openPatch, setOpenPatch] = useState<string | null>(null);
  const [patch, setPatch] = useState<string>("");
  const [openSha, setOpenSha] = useState<string | null>(null);
  const [commitFiles, setCommitFiles] = useState<CommitFilesState>({ kind: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [prSheet, setPrSheet] = useState<PrSheetState | null>(null);
  /* 分支切换确认 sheet 挂起分支名(替代 window.confirm:真机壳无 confirm delegate)。 */
  const [coSheet, setCoSheet] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (ws) localStorage.setItem(WS_KEY, ws.id);
    } catch { /* 隐私态:不持久化 */ }
  }, [ws]);

  /* 异步落定序号:慢链路乱序响应防串台(tapFile/load/loadCommitFiles 共用,失配即弃)。 */
  const seqRef = useRef(0);
  const load = useCallback(async () => {
    if (!cwd) return;
    const seq = ++seqRef.current;
    const snap = await loadGitSnapshot(cwd);
    if (seq !== seqRef.current) return; /* 旧 cwd 的迟到快照 */
    setStatus(snap.status);
    setTotals(snap.totals);
    setAb(snap.ab);
    setBranches(snap.branches);
    setLog(snap.log);
    /* 首页不满页 = 历史已到尾(翻页钮换「已显示全部」提示)。 */
    setLogDone(!snap.log || snap.log.length < LOG_LIMIT);
  }, [cwd]);

  useEffect(() => {
    setOpenPatch(null);
    setOpenSha(null);
    void load();
  }, [load]);

  const say = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4000);
  };

  /* 统一动作壳:占忙 + 错误脱壳 + 完成刷新,四动作共用。 */
  const act = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    try {
      const msg = await fn();
      if (msg) say(msg);
      await load();
    } catch (e) {
      say(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(null);
    }
  };

  const runOp = (op: RemoteOp) => {
    if (!cwd) return Promise.resolve();
    return act(op, async () => {
      const r = await invoke<GitRemoteOpReport>("git_pull_push", { cwd, op, branch: null });
      return opReportText(op, r);
    });
  };

  const openPr = () => {
    if (!cwd) return Promise.resolve();
    return act("pr", async () => {
      const d = await invoke<{
        title: string;
        canCreate: boolean;
        disabledReason: string | null;
        upstreamRepo: string;
        baseBranch: string;
        headOwner: string;
        headBranch: string;
      }>("git_pr_defaults", { cwd });
      setPrSheet({
        title: d.title,
        can: d.canCreate,
        reason: d.disabledReason ?? "",
        d: { upstreamRepo: d.upstreamRepo, baseBranch: d.baseBranch, headOwner: d.headOwner, headBranch: d.headBranch },
      });
    });
  };

  const runPr = () => {
    if (!cwd || !prSheet) return Promise.resolve();
    return act("pr-run", async () => {
      const r = await invoke<{ ok: boolean; message: string; prUrl: string | null }>("git_pr_run", {
        cwd,
        req: {
          upstreamRepo: prSheet.d.upstreamRepo,
          baseBranch: prSheet.d.baseBranch,
          headOwner: prSheet.d.headOwner,
          headBranch: prSheet.d.headBranch,
          title: prSheet.title,
          body: null,
          commentAfterCreate: false,
          commentBody: null,
        },
      }).catch(() => null);
      if (!r) return t("PR 创建失败,请稍后重试");
      setPrSheet(null);
      return r.ok ? r.message + (r.prUrl ? ` ${r.prUrl}` : "") : `PR 未创建:${r.message}`;
    });
  };

  /* 分支切换:先开确认 sheet;确认后才走统一动作壳(失败 sheet 留着可重试)。 */
  const checkout = (name: string) => {
    if (!cwd) return;
    setCoSheet(name);
  };

  const runCheckout = () => {
    if (!cwd || !coSheet) return Promise.resolve();
    const name = coSheet;
    return act("co", async () => {
      await invoke("git_checkout", { cwd, name });
      setCoSheet(null);
      return `${t("已切换到")} ${name}`;
    });
  };
  /* tapFile 键含 staged:同 path 双行(已暂存+未暂存)各自有面板,互不串台。 */
  const tapFile = async (path: string, staged: boolean, untracked: boolean) => {
    const key = `${path}|${staged ? 1 : 0}`;
    if (openPatch === key) {
      setOpenPatch(null);
      return;
    }
    const seq = ++seqRef.current;
    setOpenPatch(key);
    setPatch(t("加载中…"));
    const p = await fetchFilePatch(cwd, path, staged, untracked);
    if (seq !== seqRef.current) return;
    setPatch(!p || p.binary ? `(${t(p?.binary ? "二进制文件" : "无法获取差异")})` : p.patch || `(${t("无差异")})`);
  };
  /* 提交改动清单三态:点开置 loading,成败分别落 done/error;error 可重试。 */
  const loadCommitFiles = (sha: string) => {
    const seq = ++seqRef.current;
    setCommitFiles({ kind: "loading" });
    void fetchCommitFiles(cwd, sha)
      .then((files) => { if (seq === seqRef.current) setCommitFiles({ kind: "done", files }); })
      .catch(() => { if (seq === seqRef.current) setCommitFiles({ kind: "error" }); });
  };

  const tapCommit = (sha: string) => {
    if (openSha === sha) {
      setOpenSha(null);
      return;
    }
    setOpenSha(sha);
    loadCommitFiles(sha);
  };

  /* 日志翻页:并页去重;不满页 = 到尾;失败 toast(列表保旧页)。 */
  const loadMore = () => {
    if (!cwd || !log || moreBusy) return;
    setMoreBusy(true);
    fetchGitLogPage(cwd, log.length)
      .then((page) => {
        setLog(mergeLogPage(log, page));
        if (page.length < LOG_LIMIT) setLogDone(true);
      })
      .catch((e) => say(String(e).replace(/^Error:\s*/, "")))
      .finally(() => setMoreBusy(false));
  };


  return (
    <div className="m-screen gitscr">
      <div className="nav">
        <button className="nav-btn" onClick={props.onBack} aria-label={t("返回")}>‹</button>
        <div className="nav-title">Git</div>
        <button className="nav-pill" onClick={() => setMenu(!menu)} aria-label={t("操作")}>⋯</button>
      </div>
      <GitHeader
        workspaces={workspaces}
        wsId={ws?.id ?? ""}
        onPick={setWsId}
        status={status}
        totals={totals}
        ab={ab}
        view={view}
        onView={setView}
      />
      {ws ? (
        <>
          <div className="git-body">
            {view === "diff" && <DiffView status={status} totals={totals} openPatch={openPatch} patch={patch} onTap={tapFile} />}
            {view === "branches" && branches && (
              <>
                {branches.local.map((b) => (
                  <button key={b.name} className="git-row" onClick={() => !b.isHead && checkout(b.name)}>
                    <span className="st">{b.isHead ? "✓" : " "}</span>
                    <span className="path">{b.name}</span>
                    <span className="pm dim">{b.upstream ?? ""}</span>
                  </button>
                ))}
                {branches.remote.length > 0 && (
                  <div className="git-empty">
                    {t("远端分支")}({branches.remote.length}) · {t("完整列表与切换请在桌面查看")}
                  </div>
                )}
              </>
            )}
            {view === "history" && (
              <LogView
                log={log}
                openSha={openSha}
                commitFiles={commitFiles}
                more={!logDone && !!log?.length}
                loadingMore={moreBusy}
                onTap={tapCommit}
                onRetryFiles={() => openSha && loadCommitFiles(openSha)}
                onLoadMore={loadMore}
              />
            )}
          </div>
        </>
      ) : (
        <div className="git-empty">{t("没有可用工作区")}</div>
      )}
      <GitOverlays
        menu={menu}
        prSheet={prSheet}
        coSheet={coSheet}
        busy={busy}
        toast={toast}
        ahead={ab?.ahead ?? 0}
        onMenu={setMenu}
        onRefresh={() => void load()}
        onOp={(op) => void runOp(op)}
        onPrOpen={() => void openPr()}
        onPrClose={() => setPrSheet(null)}
        onPrRun={() => void runPr()}
        onCoClose={() => setCoSheet(null)}
        onCoConfirm={() => void runCheckout()}
      />
    </div>
  );
}
