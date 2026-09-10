/**
 * 首页页脚 —— RESUME(全工作区 × 已安装 CLI 磁盘会话,时间倒序前 8 条,
 * 点击 host.openDiskSession 直接续上)+ QUOTA(页级凭据盘点按供应商
 * title 去重聚合的套餐水位)。数据源与消费面见 WelcomePage。
 */

import { useEffect, useState } from "react";
import { host, useHost } from "@kernel/host";
import type { CliDiskSession, CliProfile } from "@kernel/cli";
import { noteSessionTabTitle } from "@kernel/sessionTabs";
import { useWorkspaces, workspaceDisplayName, type Workspace } from "@kernel/workspace";
import { SHORT_WINDOW_LABEL, isWeeklyWindow, type QuotaWindow } from "@kernel/quota";
import { formatRelativeTime } from "@kernel/relativeTime";
import { t } from "@kernel/i18n";
import type { EngineCredential } from "./credentials";

const RESUME_LIMIT = 8;
/** 配额告警线(与行内块条同语义)。 */
const QUOTA_HOT_PCT = 90;

interface ResumeItem {
  profile: CliProfile;
  workspace: Workspace;
  session: CliDiskSession;
}

async function scanAll(
  workspaces: readonly Workspace[],
  profiles: readonly CliProfile[],
): Promise<ResumeItem[]> {
  const items: ResumeItem[] = [];
  await Promise.all(
    workspaces.map(async (workspace) =>
      Promise.all(
        profiles.map(async (profile) => {
          if (!profile.listSessions) return;
          const sessions = await profile.listSessions(workspace.root).catch(() => []);
          for (const session of sessions) items.push({ profile, workspace, session });
        }),
      ),
    ),
  );
  items.sort((a, b) => b.session.modifiedAt - a.session.modifiedAt);
  return items.slice(0, RESUME_LIMIT);
}

function openItem(item: ResumeItem): void {
  const title = item.session.title ?? item.session.id.slice(0, 8);
  void host
    .openDiskSession(item.profile.id, item.workspace.root, item.workspace.id, item.session.id)
    .then((meta) => noteSessionTabTitle(meta.id, title))
    .catch(() => undefined);
}

/* ── QUOTA 聚合 ─────────────────────────────────────────── */

interface QuotaAgg {
  title: string;
  windows: QuotaWindow[];
  balanceText?: string;
  note?: string;
}

/** 按供应商 title 去重聚合:哪个引擎查到就用哪个引擎的信息填上。
 *  同 title 多副本时择优:有窗口数据 > 有余额文本 > 仅 note —— 单引擎查询
 *  失败不污染汇总(另一引擎的同一供应商盘点可能成功)。 */
function aggregateQuotas(credsMap: Record<string, EngineCredential[]>): QuotaAgg[] {
  const byTitle = new Map<string, QuotaAgg>();
  /* 无信息量条目(windows 空 + 无余额 + 无 note)直接丢弃 —— 全空副本
     不该占住行位把其他引擎查到的数据挤成 "—"。 */
  const informative = (c: EngineCredential): boolean =>
    c.windows.length > 0 || !!c.balanceText || !!c.note;
  const score = (c: Pick<EngineCredential, "windows" | "balanceText" | "note">): number =>
    (c.windows.length > 0 ? 4 : 0) + (c.balanceText ? 2 : 0) + (c.note ? 0 : 1);
  for (const creds of Object.values(credsMap)) {
    for (const c of creds) {
      if (!informative(c)) continue;
      const prev = byTitle.get(c.title);
      if (!prev || score(c) > score(prev)) {
        byTitle.set(c.title, {
          title: c.title,
          windows: c.windows,
          balanceText: c.balanceText,
          note: c.note,
        });
      }
    }
  }
  return [...byTitle.values()];
}

function QuotaBar({ w }: { w: QuotaWindow }) {
  const pct = Math.round(w.displayPercent);
  const hot = pct >= QUOTA_HOT_PCT;
  const cls = ["welcome-blk"];
  if (isWeeklyWindow(w.label)) cls.push("weekly");
  if (hot) cls.push("hot");
  return (
    <span>
      <span className="lab">{SHORT_WINDOW_LABEL[w.label] ?? t(w.label)}</span>
      <span className={cls.join(" ")}>
        <i style={{ width: `${Math.min(100, Math.max(0, w.displayPercent))}%` }} />
      </span>
      <span className={hot ? "hi" : undefined}>{pct}%</span>
    </span>
  );
}

/* ── 页脚 ───────────────────────────────────────────────── */

export function WelcomeFooter({
  credsMap,
}: {
  credsMap: Record<string, EngineCredential[]>;
}) {
  useHost(); /* profile 注册完成后重扫 */
  const { list: workspaces } = useWorkspaces();
  const [items, setItems] = useState<ResumeItem[] | null>(null);

  useEffect(() => {
    if (workspaces.length === 0) return;
    let alive = true;
    void scanAll(workspaces, host.getCliProfiles()).then((list) => {
      if (alive) setItems(list);
    });
    return () => {
      alive = false;
    };
  }, [workspaces]);

  const quotas = aggregateQuotas(credsMap);

  return (
    <div className="welcome-footer">
      <div className="col">
        <h3>resume — {t("续作")}</h3>
        {items === null && <div className="welcome-resume-empty">…</div>}
        {items?.length === 0 && (
          <div className="welcome-resume-empty">{t("暂无历史会话")}</div>
        )}
        {items?.map((item) => (
          <button
            key={`${item.profile.id}:${item.session.id}`}
            type="button"
            className="welcome-resume-row"
            onClick={() => openItem(item)}
          >
            <span className="welcome-row-name">
              <span className="icon" aria-hidden>{item.profile.renderIcon?.(12)}</span>
            </span>
            <span className="t">{item.session.title ?? item.session.id.slice(0, 8)}</span>
            <span className="w">{workspaceDisplayName(item.workspace)}</span>
            <span className="a">{formatRelativeTime(item.session.modifiedAt)}</span>
          </button>
        ))}
      </div>
      <div className="col">
        <h3>quota — {t("套餐水位")}</h3>
        {quotas.length === 0 && (
          <div className="welcome-quota-empty">{t("暂无可查询的套餐额度")}</div>
        )}
        {quotas.map((q) => (
          <div key={q.title} className="welcome-quota-row">
            <span className="qn" title={q.title}>{t(q.title)}</span>
            <span className="welcome-row-quota">
              {q.windows.length > 0 ? (
                q.windows.map((w) => <QuotaBar key={w.label} w={w} />)
              ) : q.balanceText ? (
                <span className={q.note ? "err" : undefined}>{q.balanceText}</span>
              ) : (
                <span className="lab">{q.note ?? "—"}</span>
              )}
            </span>
            <span className={`qp${q.windows.some((w) => w.displayPercent >= QUOTA_HOT_PCT) ? " hot" : ""}`}>
              {q.windows.find((w) => w.resetsAt)
                ? t("重置{rel}", {
                    rel: formatRelativeTime(q.windows.filter((w) => w.resetsAt).sort((a, b) => (a.resetsAt ?? 0) - (b.resetsAt ?? 0))[0].resetsAt!),
                  })
                : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
