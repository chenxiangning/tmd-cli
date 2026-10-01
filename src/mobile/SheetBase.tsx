/**
 * SheetBase —— 手机底部 sheet 公共基座:原生 <dialog> 遮罩 + 卡片 + 焦点管理。
 * 挂载即 showModal(top layer + dialog 语义免手搓 aria);卸载 close 并还原
 * 焦点到触发元素;移动端无 Esc,关闭只有遮罩命中钮与卡片内明确关闭钮
 * (各 sheet 自带),onCancel preventDefault 守住该语义(外接键盘不破例)。
 * 卡片类默认 .sheet(表单型);git 动作表等菜单型经 sheetClass 换 .gsheet。
 */
import { useEffect, useRef, type ReactNode } from "react";
import { t } from "@kernel/i18n";

export function SheetBase(props: {
  onClose: () => void;
  /** dialog 可读名(aria-label)。 */
  label: string;
  /** 卡片类名(gsheet 等);缺省 .sheet,传入则整体替换。 */
  sheetClass?: string;
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
        {props.children}
      </div>
    </dialog>
  );
}
