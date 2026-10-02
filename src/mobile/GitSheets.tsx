/**
 * GitSheets —— Git 面板的操作菜单 / PR 确认 / 分支切换确认弹层(纯展示,状态在 GitScreen)。
 * 统一走 SheetBase 基座(焦点管理 + 遮罩浓度一致);菜单型卡片用 .gsheet。
 */
import { t } from "@kernel/i18n";
import { SheetBase } from "./SheetBase";
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
    <SheetBase onClose={props.onClose} label={t("操作")} sheetClass="gsheet">
      <button className="sheet-row" onClick={props.onRefresh}>{t("刷新")}</button>
      <button className="sheet-row" disabled={props.busy} onClick={() => props.onOp("fetch")}>{t("获取")}</button>
      <button className="sheet-row" disabled={props.busy} onClick={() => props.onOp("pull")}>{t("拉取")}</button>
      <button className="sheet-row" disabled={props.busy} onClick={() => props.onOp("push")}>
        {t("推送")}{props.ahead ? ` (${props.ahead})` : ""}
      </button>
      <button className="sheet-row accent" disabled={props.busy} onClick={props.onPr}>{t("创建 PR")}</button>
      <button className="sheet-row" onClick={props.onClose}>{t("取消")}</button>
    </SheetBase>
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
    <SheetBase onClose={props.onClose} label={t("创建 PR")} sheetClass="gsheet">
      <div className="sheet-head">{s.can ? t("创建 PR") : t("无法创建 PR")}</div>
      <div className="sheet-note">{s.can ? s.title : s.reason}</div>
      {s.can && (
        <button className="sheet-row accent" disabled={props.busy} onClick={props.onRun}>{t("确认创建")}</button>
      )}
      <button className="sheet-row" onClick={props.onClose}>{t("取消")}</button>
    </SheetBase>
  );
}

/** 分支切换确认(替代 window.confirm:双端壳未实现 confirm delegate,真机恒 false 死钮)。 */
export function ConfirmSheet(props: {
  branch: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <SheetBase onClose={props.onClose} label={t("切换到分支")} sheetClass="gsheet">
      <div className="sheet-head">{t("切换到分支")}</div>
      <div className="sheet-note">{props.branch}</div>
      <button className="sheet-row accent" disabled={props.busy} onClick={props.onConfirm}>{t("切换")}</button>
      <button className="sheet-row" onClick={props.onClose}>{t("取消")}</button>
    </SheetBase>
  );
}
