/**
 * GitViews —— Git 面板的差异/历史视图(纯展示,数据与回调在 GitScreen)。
 */
import { t } from "@kernel/i18n";
import { ActionSheet, ConfirmSheet, PrSheet, type PrSheetState } from "./GitSheets";
import {
  commitFilesView,
  GIT_VIEW_LABEL,
  GIT_VIEWS,
  LOG_LIMIT,
  type CommitFilesState,
  type GitView,
} from "./gitModel";
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
              <span className={"st " + stClass(f.status)}>{f.status === "?" ? "U" : f.status}</span>
              <span className="path">{f.path}</span>
              {ft ? (
                <span className="pm"><b className="add">+{ft.insertions}</b> <b className="del">-{ft.deletions}</b></span>
              ) : null}
            </button>
            {props.openPatch === f.path && <DiffPatch patch={props.patch} />}
          </div>
        );
      })}
    </>
  );
}

/** 历史视图:提交行(短 sha + 摘要 + 作者)点开改动清单(三态,失败可重试);
 *  尾部 = 翻页钮 / 全量提示(git_log 分页,截断不再静默)。 */
export function LogView(props: {
  log: GitLogEntry[] | null;
  openSha: string | null;
  commitFiles: CommitFilesState;
  more: boolean;
  loadingMore: boolean;
  onTap: (sha: string) => void;
  onRetryFiles: () => void;
  onLoadMore: () => void;
}) {
  if (!props.log?.length) return <div className="git-empty">{t("没有提交历史")}</div>;
  const view = commitFilesView(props.commitFiles);
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
              {view === "loading" && t("加载中…")}
              {view === "error" && (
                <>
                  {t("改动清单加载失败")}
                  <button type="button" className="lnk-btn" onClick={props.onRetryFiles}>{t("重试")}</button>
                </>
              )}
              {view === "empty" && t("该提交无文件改动")}
              {view === "list" && props.commitFiles.kind === "done" && props.commitFiles.files.map((f) => (
                <div key={f.path} className="cf-row">
                  {f.path} <b className="add">+{f.additions}</b>
                  <b className="del"> -{f.deletions}</b>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      {props.more ? (
        <button className="more" disabled={props.loadingMore} onClick={props.onLoadMore}>
          {props.loadingMore ? t("加载中…") : t("加载更多")}
        </button>
      ) : props.log.length >= LOG_LIMIT ? (
        <div className="list-note">{t("已显示全部 {n} 条提交", { n: props.log.length })}</div>
      ) : null}
    </>
  );
}


/** 顶区:工作区 chips + 分支/±/⇅ 摘要 + 差异/分支/历史 切换(枚举英文,标签 t())。 */
export function GitHeader(props: {
  workspaces: { id: string; name: string }[];
  wsId: string;
  onPick: (id: string) => void;
  status: GitDiffStatus | null;
  totals: GitTotals | null;
  ab: GitAheadBehind | null;
  view: GitView;
  onView: (v: GitView) => void;
}) {
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
          {GIT_VIEWS.map((v) => (
            <button key={v} role="tab" aria-selected={props.view === v} className={props.view === v ? "on" : ""} onClick={() => props.onView(v)}>
              {t(GIT_VIEW_LABEL[v])}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}


/** 底部浮层:操作菜单 / PR 确认 / 分支切换确认 / 占忙与结果 toast。 */
export function GitOverlays(props: {
  menu: boolean;
  prSheet: PrSheetState | null;
  coSheet: string | null;
  busy: string | null;
  toast: string | null;
  ahead: number;
  onMenu: (open: boolean) => void;
  onRefresh: () => void;
  onOp: (op: "fetch" | "pull" | "push") => void;
  onPrOpen: () => void;
  onPrClose: () => void;
  onPrRun: () => void;
  onCoClose: () => void;
  onCoConfirm: () => void;
}) {
  const busyText = busyOpText(props.busy);
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
      {props.coSheet && (
        <ConfirmSheet
          branch={props.coSheet}
          busy={props.busy === "co"}
          onClose={props.onCoClose}
          onConfirm={props.onCoConfirm}
        />
      )}
      {(props.busy || props.toast) && (
        <div className={"git-toast" + (props.toast ? "" : " busy")}>{props.toast ?? busyText}</div>
      )}
    </>
  );
}

/** 占忙文案:op 键 → 人话(裸 "fetch…" 类英文键不再上屏)。 */
function busyOpText(busy: string | null): string {
  if (busy === "pr-run" || busy === "pr") return "PR…";
  if (busy === "co") return t("切换中…");
  if (busy === "more") return t("加载中…");
  if (busy === "fetch") return t("获取中…");
  if (busy === "pull") return t("拉取中…");
  if (busy === "push") return t("推送中…");
  return `${busy}…`;
}


/** git 状态字母 → 颜色类(M 改/A 增/D 删/U 未跟踪/C 冲突,R/T 沿用改动色)。 */
function stClass(status: string): string {
  if (status === "A") return "st-a";
  if (status === "D" || status === "C") return "st-d";
  if (status === "?") return "st-u";
  if (status === "R" || status === "T") return "st-r";
  return "st-m"; /* M:变更警示色,对齐桌面 STATUS_COLOR */
}

/** patch 按行着色:+ 添加绿 / - 删除红 / @@ hunk 暗淡,其余正文。 */
function DiffPatch(props: { patch: string }) {
  const seen = new Map<string, number>();
  return (
    <pre className="git-patch">
      {props.patch.split("\n").map((line) => {
        /* 同内容行去重计数,内容寻址 key(静态行渲染,无重排语义) */
        const n = seen.get(line) ?? 0;
        seen.set(line, n + 1);
        const cls = line.startsWith("+") ? "dl-add" : line.startsWith("-") ? "dl-del" : line.startsWith("@@") ? "dl-hunk" : undefined;
        return (
          <span key={`${n}:${line}`} className={cls}>
            {line}
            {"\n"}
          </span>
        );
      })}
    </pre>
  );
}
