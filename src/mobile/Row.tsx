/**
 * home 会话行(活/磁盘同形)—— 自 HomeScreen 拆出(文件规模铁则;
 * react-doctor「组件文件只出组件」纪律)。置顶钮是行容器兄弟钮(禁嵌套 button)。
 */
import { t } from "@kernel/i18n";
import { relTime } from "./remote";
import { EngineMark } from "./EngineMark";
import type { HomeRow } from "./history";

export function Row(props: {
  r: HomeRow;
  active: boolean;
  pending: number;
  pinned: boolean;
  onTogglePin: () => void;
  onOpen: () => void;
}) {
  const live = props.r.kind === "live";
  /* 无稳定磁盘身份(未绑定的新活会话)不可置顶:钮不渲染 */
  const canPin = live ? !!props.r.live?.cliSessionId : true;
  return (
    <div className={`row${props.active ? " active" : ""}`}>
      <button type="button" className="row-main" onClick={props.onOpen}>
        <EngineMark profileId={props.r.profileId} />
        <span className="t">{props.r.title}</span>
        {live && props.pending > 0 && (
          <span className="pill">{t("审批 {n}", { n: props.pending })}</span>
        )}
        <span className="meta">{relTime(props.r.ts)}</span>
        <span className={`sdot${live && props.pending > 0 ? " ask" : ""}`} />
      </button>
      {canPin && (
        <button
          type="button"
          className={`pin${props.pinned ? " on" : ""}`}
          aria-label={props.pinned ? t("取消置顶") : t("置顶")}
          onClick={props.onTogglePin}
        >
          📌
        </button>
      )}
    </div>
  );
}
