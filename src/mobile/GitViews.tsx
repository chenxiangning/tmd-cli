/**
 * GitViews —— Git 面板的差异/历史视图(纯展示,数据与回调在 GitScreen)。
 */
import { t } from "@kernel/i18n";
import { ActionSheet, PrSheet, type PrSheetState } from "./GitSheets";
import type { GitAheadBehind, GitDiffStatus, GitLogEntry, GitTotals } from "@kernel/gitContract";

/** 差异视图:文件行(状态字母 + 单侧 ±)+ 点开 patch。 */
export function DiffView(props: {
  status: GitDiffStatus | null;
  totals: GitTotals | null;
  openPatch: string | null;
  patch: string;
  onTap: (path: string, staged: boolean, untracked: boolean) => void;
}) {
  const files = props.status?.files ?? [];
  if (!files.length) return <div className="git-empty">{t("工作区干净,没有未提交改动")}</div>;
  return (
    <>
      {files.map((f) => {
        const ft = props.totals?.files.find((x) => x.path === f.path && x.staged === f.staged);
        return (
          <div key={f.path + (f.staged ? "~s" : "")}>
            <button className="git-row" onClick={() => props.onTap(f.path, f.staged, f.status === "?")}>
              <span className="st">{f.status === "?" ? "U" : f.status}</span>
              <span className="path">{f.path}</span>
              {ft ? (
                <span className="pm"><b className="add">+{ft.insertions}</b> <b className="del">-{ft.deletions}</b></span>
              ) : null}
            </button>
            {props.openPatch === f.path && <pre className="git-patch">{props.patch}</pre>}
          </div>
        );
      })}
    </>
  );
}

/** 历史视图:提交行(短 sha + 摘要 + 作者)点开改动清单。 */
export function LogView(props: {
  log: GitLogEntry[] | null;
  openSha: string | null;
  commitFiles: { path: string; additions: number; deletions: number }[];
  onTap: (sha: string) => void;
}) {
  if (!props.log?.length) return <div className="git-empty">{t("没有提交历史")}</div>;
  return (
    <>
      {props.log.map((c) => (
        <div key={c.longSha}>
          <button className="git-row" onClick={() => props.onTap(c.longSha)}>
            <span className="st mono">{c.shortSha}</span>
            <span className="path">{c.summary}</span>
            <span className="pm dim">{c.authorName}</span>
          </button>
          {props.openSha === c.longSha && (
            <div className="git-patch">
              {props.commitFiles.length
                ? props.commitFiles.map((f) => (
                    <div key={f.path} className="cf-row">
                      {f.path} <b className="add">+{f.additions}</b>
                      <b className="del"> -{f.deletions}</b>
                    </div>
                  ))
                : t("加载中…")}
            </div>
          )}
        </div>
      ))}
    </>
  );
}


/** 顶区:工作区 chips + 分支/±/⇅ 摘要 + 差异/分支/历史 切换。 */
export function GitHeader(props: {
  workspaces: { id: string; name: string }[];
  wsId: string;
  onPick: (id: string) => void;
  status: GitDiffStatus | null;
  totals: GitTotals | null;
  ab: GitAheadBehind | null;
  view: string;
  onView: (v: "差异" | "分支" | "历史") => void;
}) {
  const VIEWS = ["差异", "分支", "历史"] as const;
  return (
    <>
      <div className="ws-chips">
        {props.workspaces.map((w) => (
          <button key={w.id} className={"chip-ws" + (w.id === props.wsId ? " on" : "")} onClick={() => props.onPick(w.id)}>
            {w.name}
          </button>
        ))}
      </div>
      <div className="git-subbar">
        <span className="git-branch">{props.status ? props.status.branch : "…"}</span>
        <span className="git-nums">
          {props.totals ? <b className="add">+{props.totals.insertions}</b> : null}
          {props.totals ? <b className="del"> /-{props.totals.deletions}</b> : null}
          {props.ab && (props.ab.ahead || props.ab.behind) ? (
            <span className="ab"> ⇅{props.ab.ahead}/{props.ab.behind}</span>
          ) : null}
        </span>
        <div className="seg" role="tablist">
          {VIEWS.map((v) => (
            <button key={v} role="tab" aria-selected={props.view === v} className={props.view === v ? "on" : ""} onClick={() => props.onView(v)}>
              {v}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}


/** 底部浮层:操作菜单 / PR 确认 / 占忙与结果 toast。 */
export function GitOverlays(props: {
  menu: boolean;
  prSheet: PrSheetState | null;
  busy: string | null;
  toast: string | null;
  ahead: number;
  onMenu: (open: boolean) => void;
  onRefresh: () => void;
  onOp: (op: "fetch" | "pull" | "push") => void;
  onPrOpen: () => void;
  onPrClose: () => void;
  onPrRun: () => void;
}) {
  const busyText =
    props.busy === "pr-run" || props.busy === "pr" ? "PR…" : props.busy === "co" ? t("切换中…") : `${props.busy}…`;
  return (
    <>
      {props.menu && (
        <ActionSheet
          ahead={props.ahead}
          busy={!!props.busy}
          onClose={() => props.onMenu(false)}
          onRefresh={() => {
            props.onMenu(false);
            props.onRefresh();
          }}
          onOp={(op) => {
            props.onMenu(false);
            props.onOp(op);
          }}
          onPr={() => {
            props.onMenu(false);
            props.onPrOpen();
          }}
        />
      )}
      {props.prSheet && (
        <PrSheet state={props.prSheet} busy={props.busy === "pr-run"} onClose={props.onPrClose} onRun={props.onPrRun} />
      )}
      {(props.busy || props.toast) && (
        <div className={"git-toast" + (props.toast ? "" : " busy")}>{props.toast ?? busyText}</div>
      )}
    </>
  );
}
