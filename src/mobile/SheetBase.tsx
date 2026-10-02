/**
 * SheetBase —— 手机底部 sheet 公共基座:原生 <dialog> 遮罩 + 卡片 + 焦点管理。
 * 挂载即 showModal(top layer + dialog 语义免手搓 aria);卸载 close 并还原
 * 焦点到触发元素;移动端无 Esc,关闭 = 遮罩命中钮 + 标题行 ✕(title 在场时),
 * onCancel preventDefault 守住该语义(外接键盘不破例)。
 * 卡片类默认 .sheet(表单型);git 动作表等菜单型经 sheetClass 换 .gsheet。
 * 基座统一渲染 grabber 把手;title 在场再渲染标题行 + 关闭钮
 * (spec 2026-10-03-mobile-spawn-sheet-polish-design)。
 */
import { useEffect, useRef, type ReactNode } from "react";
import { t } from "@kernel/i18n";

/** 关闭钮细线 X(与 treeIcons 同规格:1.5 stroke / round cap)。 */
function XIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <path d="m4 4.5 8 7M12 4.5l-8 7" />
    </svg>
  );
}

export function SheetBase(props: {
  onClose: () => void;
  /** dialog 可读名(aria-label)。 */
  label: string;
  /** 卡片类名(gsheet 等);缺省 .sheet,传入则整体替换。 */
  sheetClass?: string;
  /** 标题;在场渲染标题行 + ✕ 关闭钮(gsheet 菜单型自带 sheet-head,缺省不传)。 */
  title?: string;
  children: ReactNode;
}) {
  const dlgRef = useRef<HTMLDialogElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  /* 焦点进出:sheet 挂载 showModal 抢焦点进卡片(读屏/键盘跟随),
     卸载 close 还原到触发钮(遮罩点击/动作完成都会卸载)。 */
  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dlg.showModal();
    cardRef.current?.focus();
    return () => {
      dlg.close();
      prev?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dlgRef}
      aria-label={props.label}
      className="sheet-scrim"
      onCancel={(e) => e.preventDefault()}
    >
      <button type="button" aria-label={t("关闭")} tabIndex={-1} className="sheet-scrim-hit" onClick={props.onClose} />
      <div ref={cardRef} tabIndex={-1} className={props.sheetClass ?? "sheet"}>
        <div className="sheet-grab" aria-hidden />
        {props.title !== undefined && (
          <div className="sheet-titlebar">
            <div className="sheet-title">{props.title}</div>
            <button type="button" className="sheet-x" aria-label={t("关闭")} onClick={props.onClose}>
              <XIcon />
            </button>
          </div>
        )}
        {props.children}
      </div>
    </dialog>
  );
}
