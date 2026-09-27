/**
 * 回窗待办卡呈现面 —— overlay 挂点组件(spec 2026-09-27)。
 * 状态机在 returnCardStore.ts(react-doctor only-export-components 拆分);
 * 行点击 = setActiveSession + 幕布聚焦(approval-inbox gotoAndFocus 同款机制),
 * 不代发作答键(M2 评审 A2),把人送到现场自己按。
 * 视觉与退出卡(sft)同区同语;空快照渲染 null。
 */
import { X } from "@phosphor-icons/react";
import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import { getSettingsState } from "@kernel/settings";
import { getSessionTabTitle } from "@kernel/sessionTabs";
import { sessionTitleKey, shortId } from "@kernel/sessionTitles";
import { getTerminalHandle } from "@kernel/messageAnchors";
import { closeReturnCard, resolveReturnRow, useReturnCard } from "./returnCardStore";
import "./return-card.css";

/** 标题解析:手动命名 > 打开快照 > meta 标题 > 短码(SessionTabBar / approval-inbox 同源链)。 */
function resolveTitle(sessionId: string): string {
  const meta = host.getSessions().find((s) => s.id === sessionId);
  if (!meta) return shortId(sessionId);
  const cliSessionId = host.getCliSessionId(sessionId);
  const manual = cliSessionId
    ? getSettingsState().settings.sessionTitles[sessionTitleKey(meta.profileId, cliSessionId)]
    : undefined;
  return manual ?? getSessionTabTitle(sessionId) ?? meta.title ?? shortId(sessionId);
}

function jumpToSession(sessionId: string): void {
  host.setActiveSession(sessionId);
  getTerminalHandle(sessionId)?.focus();
  resolveReturnRow(sessionId);
}

/** 纯呈现面(测试 renderToStaticMarkup 断言;快照经 props 传入)。 */
export function ReturnCardView({ ids }: { ids: readonly string[] }) {
  if (ids.length === 0) return null;
  return (
    <div className="nr-card" role="alert">
      <div className="nr-head">
        <span className="nr-head-t">{t("{n} 个会话在等你确认", { n: ids.length })}</span>
        <button type="button" className="nr-close" aria-label={t("关闭待办卡")} onClick={closeReturnCard}>
          <X size="0.75rem" aria-hidden />
        </button>
      </div>
      <div className="nr-rows">
        {ids.map((id) => {
          const meta = host.getSessions().find((s) => s.id === id);
          const eng = (meta && host.getCliProfile(meta.profileId)?.name) ?? meta?.profileId ?? "CLI";
          return (
            <button key={id} type="button" className="nr-row" onClick={() => jumpToSession(id)}>
              <span className="nr-eng">{eng}</span>
              <span className="nr-title">{resolveTitle(id)}</span>
              <span className="nr-wait">{t("等待确认")}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** overlay 挂点组件(index.tsx contribute;空快照渲染 null)。 */
export function ReturnCardOverlay() {
  const { ids } = useReturnCard();
  return <ReturnCardView ids={ids} />;
}
