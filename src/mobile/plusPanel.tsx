/**
 * 「+」五格面板 —— composer 胶囊工具区(自 Composer.tsx 拆出守 300 铁则):
 *  相册 = pickImage 选图;切模型 = 填 /model 草稿(发送后键条驱动 TUI);
 *  检查点 = CkptSheet(无 cwd 置灰);快捷键 = 键条开关(格随 kbOn 点亮);
 *  时间线 = 本会话用户消息流 sheet(不支持引擎置灰;spec 2026-10-05-mobile-
 *  session-timeline)。
 */
import {
  ClockCounterClockwise,
  Images,
  Keyboard,
  ListNumbers,
  SlidersHorizontal,
} from "@phosphor-icons/react";
import { t } from "@kernel/i18n";

export function PlusPanel(props: {
  shotBusy: boolean;
  ckptReady: boolean;
  kbOn: boolean;
  timelineReady: boolean;
  onShot: () => void;
  onModel: () => void;
  onCkpt: () => void;
  onTimeline: () => void;
  onToggleKb: () => void;
}) {
  return (
    <div className="cp-panel">
      <button type="button" className="cp-tile" disabled={props.shotBusy} onClick={props.onShot}>
        <Images size={21} />
        {t("相册")}
      </button>
      <button type="button" className="cp-tile" onClick={props.onModel}>
        <SlidersHorizontal size={21} />
        {t("切模型")}
      </button>
      <button type="button" className="cp-tile" disabled={!props.ckptReady} onClick={props.onCkpt}>
        <ClockCounterClockwise size={21} />
        {t("检查点")}
      </button>
      <button type="button" className="cp-tile" disabled={!props.timelineReady} onClick={props.onTimeline}>
        <ListNumbers size={21} />
        {t("时间线")}
      </button>
      <button type="button" className={"cp-tile" + (props.kbOn ? " on" : "")} onClick={props.onToggleKb}>
        <Keyboard size={21} />
        {t("快捷键")}
      </button>
    </div>
  );
}
