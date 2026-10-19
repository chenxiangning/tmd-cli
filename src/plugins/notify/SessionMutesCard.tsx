/**
 * 静音中的会话概览卡(NotifySettingsTab 第三重可见性兜底)。
 * 列出全部 sessionMutes 覆盖层条目:档位标 + 取消钮;空态整卡不渲染。
 * 行名:活会话在册取标题;否则 CLI 档名 + 短码(三段 key 手工拆段,展示用)。
 */

import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import { useSettingsState } from "@kernel/settings";
import { sessionMuteModeLabel, unmuteSession } from "@kernel/sessionMutes";
import { shortId } from "@kernel/sessionTitles";
import { CardHead } from "./NotifySettingsTab";

/** 三段 key → 展示名:活会话标题 > CLI 档名 · 短码 > 短码。 */
function muteSessionName(key: string): string {
  const first = key.indexOf(":");
  const last = key.lastIndexOf(":");
  if (first <= 0 || last <= first) return key;
  const workspaceId = key.slice(0, first);
  const profileId = key.slice(first + 1, last);
  const cliSessionId = key.slice(last + 1);
  const live = host
    .getSessions()
    .find(
      (s) =>
        s.workspaceId === workspaceId &&
        s.profileId === profileId &&
        host.getCliSessionId(s.id) === cliSessionId,
    );
  if (live?.title) return live.title;
  const profile = host.getCliProfile(profileId);
  return profile ? `${profile.name} · ${shortId(cliSessionId)}` : shortId(cliSessionId);
}

export function SessionMutesCard() {
  const { settings } = useSettingsState();
  const entries = Object.entries(settings.sessionMutes);
  if (entries.length === 0) return null; /* 空态整卡不渲染 */
  return (
    <div className="pref-card" data-testid="settings-session-mutes-card">
      <CardHead
        title={t("静音中的会话({n})", { n: entries.length })}
        desc={t("静音只拦系统通知与提示音,通知中心流水照常记录。")}
      />
      {entries.map(([key, entry]) => (
        <div className="pref-row" key={key}>
          <div className="min-w-0">
            <div className="pref-title truncate">{muteSessionName(key)}</div>
            <div className="pref-desc">
              {sessionMuteModeLabel(entry.mode)}
              {entry.mode === "full" && entry.askRing !== true ? ` · ${t("ask 亦静")}` : ""}
            </div>
          </div>
          <button
            type="button"
            className="flex-none text-2xs text-(--tmd-fg-faint) hover:underline"
            onClick={() => unmuteSession(key)}
          >
            {t("取消静音")}
          </button>
        </div>
      ))}
    </div>
  );
}
