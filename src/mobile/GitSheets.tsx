/**
 * GitSheets —— Git 面板的操作菜单与 PR 确认弹层(纯展示,状态在 GitScreen)。
 */
import { t } from "@kernel/i18n";
import type { RemoteOp } from "./gitModel";

export interface PrSheetState {
  title: string;
  can: boolean;
  reason: string;
  d: { upstreamRepo: string; baseBranch: string; headOwner: string; headBranch: string };
}

export function ActionSheet(props: {
  ahead: number;
  busy: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onOp: (op: RemoteOp) => void;
  onPr: () => void;
}) {
  return (
    <div className="sheet-mask" onClick={props.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <button className="sheet-row" onClick={props.onRefresh}>{t("刷新")}</button>
        <button className="sheet-row" disabled={props.busy} onClick={() => props.onOp("fetch")}>{t("获取")}</button>
        <button className="sheet-row" disabled={props.busy} onClick={() => props.onOp("pull")}>{t("拉取")}</button>
        <button className="sheet-row" disabled={props.busy} onClick={() => props.onOp("push")}>
          {t("推送")}{props.ahead ? ` (${props.ahead})` : ""}
        </button>
        <button className="sheet-row accent" disabled={props.busy} onClick={props.onPr}>{t("创建 PR")}</button>
        <button className="sheet-row" onClick={props.onClose}>{t("取消")}</button>
      </div>
    </div>
  );
}

export function PrSheet(props: {
  state: PrSheetState;
  busy: boolean;
  onClose: () => void;
  onRun: () => void;
}) {
  const s = props.state;
  return (
    <div className="sheet-mask" onClick={props.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">{s.can ? t("创建 PR") : t("无法创建 PR")}</div>
        <div className="sheet-note">{s.can ? s.title : s.reason}</div>
        {s.can && (
          <button className="sheet-row accent" disabled={props.busy} onClick={props.onRun}>{t("确认创建")}</button>
        )}
        <button className="sheet-row" onClick={props.onClose}>{t("取消")}</button>
      </div>
    </div>
  );
}
