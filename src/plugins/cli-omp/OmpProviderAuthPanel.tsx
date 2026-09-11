/**
 * omp 供应商认证面板 —— 见 docs/superpowers/specs/2026-09-11-cli-provider-channels-design.md。
 *
 * 两段(codemoss 同款):订阅授权(8 行 OAuth,只读状态 + 登录 = 经内置终端驱动
 * `omp auth-broker login <arg>`)+ API Key(36 供应商,设置 Key/编辑/删除写
 * agent.db auth_credentials,掩码展示,featured 折叠 + 筛选)。
 * omp 专属知识全在本插件;存储操作在 providerAuth.ts。
 */

import { useCallback, useEffect, useState } from "react";
import { t } from "@kernel/i18n";
import { listOmpAuth, setOmpApiKey, deleteOmpCredential, type OmpAuthList } from "./providerAuth";
import { OMP_OAUTH_PROVIDERS, BrandAvatar, StatusDot, launchLogin } from "./OmpOauthSection";
import { OmpModelsConfigSection } from "./OmpModelsConfigSection";
import { KeyDialog } from "./OmpKeyDialog";

export function OmpProviderAuthPanel() {
  const [list, setList] = useState<OmpAuthList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [keyTarget, setKeyTarget] = useState<{ id: string; name: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const refresh = useCallback(
    () =>
      listOmpAuth()
        .then(setList)
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))),
    [],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const oauthSet = list?.oauthActive ?? new Set<string>();
  const oauthRefresh = list?.oauthRefresh ?? new Set<string>();

  const handleSaveKey = useCallback(
    async (id: string, key: string) => {
      setSaving(true);
      setError(null);
      try {
        await setOmpApiKey(id, key);
        await refresh();
        setNotice(t("已保存 {id} 的 API Key", { id }));
        setKeyTarget(null);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    },
    [refresh],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setError(null);
      try {
        await deleteOmpCredential(id);
        await refresh();
        setNotice(t("已删除 {id} 的 API Key", { id }));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setConfirmDelete(null);
      }
    },
    [refresh],
  );

  const filtered = list
    ? filter.trim()
      ? list.providers.filter((p) =>
          `${p.name} ${p.envVar}`.toLowerCase().includes(filter.trim().toLowerCase()),
        )
      : list.providers.filter((p) => showAll || p.featured)
    : [];

  return (
    <section className="provider-panel mt-6" data-testid="provider-auth-panel">
      <header className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-(--tmd-fg)">{t("供应商认证")}</h3>
      </header>

      {error && (
        <div className="cli-cfg-error mt-3" role="alert" data-testid="provider-auth-error">
          <p>{error}</p>
          <button type="button" className="cli-cfg-link" onClick={() => setError(null)}>
            {t("关闭")}
          </button>
        </div>
      )}
      {notice && !error && (
        <p className="mt-3 text-xs text-(--tmd-fg-muted)" data-testid="provider-auth-notice">
          {notice}
        </p>
      )}

      <div className="mt-4 flex items-baseline gap-2">
        <h4 className="text-xs font-semibold text-(--tmd-fg)">{t("订阅授权")}</h4>
        <span className="text-[0.6875rem] text-(--tmd-fg-muted)">
          {t("OAuth 登录,token 自动刷新,由 omp CLI 存储")}
        </span>
      </div>
      <ul
        className="mt-2 divide-y divide-(--tmd-border) overflow-hidden rounded-lg border border-(--tmd-border) bg-(--tmd-bg-card)"
        data-testid="provider-auth-oauth"
      >
        {OMP_OAUTH_PROVIDERS.map((p) => {
          const subscribed = p.statusIds.some((id) => oauthSet.has(id));
          return (
            <li key={p.id} className="flex min-h-[3.25rem] items-center gap-3 px-3 py-2.5">
              <BrandAvatar id={p.id} name={p.name} icon={p.icon} />
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="truncate text-xs text-(--tmd-fg)">{p.name}</p>
                <p className="truncate text-[0.6875rem] text-(--tmd-fg-muted)">{p.desc}</p>
              </div>
              <span className="flex shrink-0 items-center gap-1.5 text-[0.6875rem] text-(--tmd-fg-muted)">
                <StatusDot on={subscribed} />
                {subscribed
                  ? oauthRefresh.has(p.id)
                    ? `${t("已授权")} · ${t("自动刷新")}`
                    : t("已授权")
                  : t("未授权")}
              </span>
              <button
                type="button"
                className="cli-cfg-btn shrink-0"
                title={`omp auth-broker login ${p.loginArg}`}
                disabled={!list}
                onClick={() => {
                  void launchLogin(p)
                    .then(() =>
                      setNotice(t("已在内置终端打开 {name} 的登录流程,完成后回到此处查看状态", { name: p.name })),
                    )
                    .catch((e: unknown) =>
                      setError(e instanceof Error ? e.message : String(e)),
                    );
                }}
                data-testid={`provider-auth-login-${p.id}`}
              >
                {t("登录")}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-5 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h4 className="shrink-0 text-xs font-semibold text-(--tmd-fg)">{t("API Key")}</h4>
          <span className="truncate text-[0.6875rem] text-(--tmd-fg-muted)">
            {t("写入 ~/.omp/agent/agent.db · 优先级高于环境变量")}
          </span>
        </div>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("筛选供应商…")}
          className="w-40 shrink-0 rounded border border-(--tmd-border) bg-(--tmd-bg) px-2 py-1 text-xs"
          data-testid="provider-auth-filter"
        />
      </div>
      <ul
        className="mt-2 divide-y divide-(--tmd-border) overflow-hidden rounded-lg border border-(--tmd-border) bg-(--tmd-bg-card)"
        data-testid="provider-auth-apikeys"
      >
        {filtered.map((p) => {
          const configured = p.state === "configured";
          const deleting = confirmDelete === p.id;
          return (
            <li key={p.id} className="flex min-h-[3.25rem] items-center gap-3 px-3 py-2.5">
              <BrandAvatar id={p.id} name={p.name} icon={p.icon} />
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="truncate text-xs text-(--tmd-fg)">{p.name}</p>
                {p.envVar && (
                  <p className="truncate font-mono text-[0.6875rem] text-(--tmd-fg-muted)">{p.envVar}</p>
                )}
              </div>
              <span className="flex shrink-0 items-center gap-1.5 text-[0.6875rem] text-(--tmd-fg-muted)">
                <StatusDot on={configured} />
                {configured ? t("已配置") : t("未配置")}
              </span>
              {configured && (
                <code
                  className="shrink-0 rounded bg-(--tmd-bg-popover) px-1.5 py-0.5 font-mono text-[0.6875rem] text-(--tmd-fg-muted)"
                  data-testid={`provider-auth-mask-${p.id}`}
                >
                  {p.maskedKey}
                </code>
              )}
              {configured ? (
                <>
                  <button
                    type="button"
                    className="cli-cfg-btn shrink-0"
                    onClick={() => setKeyTarget({ id: p.id, name: p.name })}
                    data-testid={`provider-auth-edit-${p.id}`}
                  >
                    {t("编辑")}
                  </button>
                  {deleting ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        className="cli-cfg-btn is-danger"
                        onClick={() => void handleDelete(p.id)}
                        data-testid={`provider-auth-confirm-delete-${p.id}`}
                      >
                        {t("确认删除")}
                      </button>
                      <button type="button" className="cli-cfg-btn" onClick={() => setConfirmDelete(null)}>
                        {t("取消")}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="cli-cfg-btn shrink-0"
                      onClick={() => setConfirmDelete(p.id)}
                      data-testid={`provider-auth-delete-${p.id}`}
                    >
                      {t("删除")}
                    </button>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  className="cli-cfg-btn shrink-0"
                  onClick={() => setKeyTarget({ id: p.id, name: p.name })}
                  data-testid={`provider-auth-set-${p.id}`}
                >
                  {t("设置 Key")}
                </button>
              )}
            </li>
          );
        })}
        {list && filtered.length === 0 && (
          <li className="px-3 py-6 text-center text-xs text-(--tmd-fg-muted)">
            {t("没有匹配的供应商")}
          </li>
        )}
      </ul>
      {!filter.trim() && (
        <button type="button" className="cli-cfg-link mt-2" onClick={() => setShowAll((v) => !v)}>
          {showAll ? t("收起") : t("显示全部 37 个供应商")}
        </button>
      )}

      <OmpModelsConfigSection />

      {keyTarget && (
        <KeyDialog
          name={keyTarget.name}
          saving={saving}
          onClose={() => setKeyTarget(null)}
          onSubmit={(key) => void handleSaveKey(keyTarget.id, key)}
        />
      )}
    </section>
  );
}
