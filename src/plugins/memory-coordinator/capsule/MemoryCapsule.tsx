/**
 * 记忆胶囊 —— composer.statusBar 挂点,5 家读通路(Phase 1)。
 *
 * 行为(spec §8.1):非豁免引擎(claude/codex/grok/kimi/qoder×2)活跃会话时,
 * 按当前 workspace 项目身份查池;命中则渲染胶囊,展开勾选,「注入」把所选
 * 记忆拼为消息前缀并插入 composer 输入框(经 execCommand insertText 走
 * React onChange,发送仍由用户触发 —— 即用户输入,零 PTY 侵入)。
 * 豁免(omp/pi/opencode):原生注入已覆盖,不渲染。池故障:零打扰。
 */

import { useEffect, useMemo, useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { host, useHost } from "@kernel/host";
import { useSettingsState } from "@kernel/settings";
import { NATIVE_INJECT_PROFILES, CATEGORY_CN, type MemoryItem } from "../protocol";
import { memoryPool, resolveProjectIdentity } from "../pool";
import { useWorkspaces } from "@kernel/workspace";
import { t } from "@kernel/i18n";

const COMPOSER_TEXTAREA_ID = "composer-textarea";

export function MemoryCapsule() {
  useHost();
  const { settings } = useSettingsState();
  const workspaces = useWorkspaces();
  const activeId = host.getActiveSessionId();
  const profile = activeId ? host.getCliProfile(host.getSessions().find((s) => s.id === activeId)?.profileId ?? "") : undefined;
  const exempt = profile ? NATIVE_INJECT_PROFILES[profile.id] === true : true;

  const root = workspaces.list.find((w) => w.id === workspaces.activeId)?.root ?? "";
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [injected, setInjected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setItems([]);
      setExpanded(false);
      setChecked(new Set());
      setInjected(false);
      if (exempt || !root) return;
      const id = await resolveProjectIdentity(root);
      if (cancelled) return;
      if (!id) return;
      const st = await memoryPool.status();
      if (cancelled || !st.ready) return;
      const list = await memoryPool.recall(id, undefined, 20);
      if (cancelled) return;
      setItems(list);
      // auto 模式:新会话自动展开(spec §8.1);仅本次会话首个命中集生效
      if (settings.memoryCapsuleMode === "auto" && list.length > 0) setExpanded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [exempt, root, activeId, settings.memoryCapsuleMode]);

  const disabled = !settings.memoryEnabled || settings.memoryCapsuleMode === "off";
  const visible = !disabled && !exempt && items.length > 0;

  const inject = () => {
    const chosen = [...checked].map((i) => items[i]);
    if (chosen.length === 0) return;
    const prefix =
      t("[项目记忆 · {n} 条]", { n: chosen.length }) + "\n" +
      chosen.map((m) => `- (${t((CATEGORY_CN as Record<string, string>)[m.category] ?? m.category)}) ${m.content}`).join("\n") +
      "\n";
    const textarea = document.getElementById(COMPOSER_TEXTAREA_ID) as HTMLTextAreaElement | null;
    if (!textarea) return;
    textarea.focus();
    const ok = document.execCommand("insertText", false, prefix);
    if (!ok) {
      // execCommand 不可用时回退:粘贴板(用户 ⌘V)
      navigator.clipboard?.writeText(prefix).catch(() => {});
    }
    setInjected(true);
    setExpanded(false);
  };

  const checkedCount = useMemo(() => checked.size, [checked]);

  if (!visible) return null;

  return (
    <>
      <div className="flex min-w-0 flex-none flex-wrap items-center gap-x-2 gap-y-1 border-b border-(--tmd-border) bg-(--tmd-accent-soft) px-2.5 py-1">
        <button
          type="button"
          className="flex h-[22px] items-center gap-1.5 rounded-full bg-(--tmd-bg-active) px-2.5 text-[0.6875rem] text-(--tmd-fg) hover:shadow-[0_0_0_1px_var(--tmd-accent)]"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <span>{t("项目记忆")}</span>
          <span className="font-bold text-(--tmd-accent)">{items.length}</span>
          <span>{t("条")}</span>
          <CaretDown
            size="0.6875rem"
            className={expanded ? "rotate-180 transition-transform" : "transition-transform"}
          />
        </button>
        <span className="min-w-0 flex-1 truncate text-[0.65625rem] text-(--tmd-fg-subtle)">
          {t("Magic Context 池 · ")}<span className="text-(--tmd-fg-faint)">{t("omp/pi 会话沉淀")}</span>
        </span>
      </div>

      {expanded && (
        <div className="flex-none border-b border-(--tmd-border) px-2.5 pb-2 pt-1.5">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-[0.71875rem] font-semibold">{t("项目记忆")}</span>
            <span className="text-[0.65625rem] text-(--tmd-fg-faint)">{t("勾选后注入为消息前缀")}</span>
            <span className="ml-auto flex flex-none gap-1.5">
              <button
                className="h-[22px] rounded-md border border-(--tmd-border) px-2.5 text-[0.6875rem] text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
                onClick={() => setChecked(checked.size === items.length ? new Set() : new Set(items.map((_, i) => i)))}
              >
                {checked.size === items.length ? t("全不选") : t("全选")}
              </button>
              <button
                className="h-[22px] rounded-md border border-(--tmd-accent) bg-(--tmd-accent) px-2.5 text-[0.6875rem] text-(--tmd-accent-fg) disabled:opacity-45"
                disabled={checked.size === 0}
                onClick={inject}
              >
                {t("注入")}
              </button>
            </span>
          </div>
          <div className="flex max-h-36 flex-col gap-0.5 overflow-y-auto">
            {items.map((m, i) => (
              <div
                key={m.id}
                className={`flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 text-[0.6875rem] leading-[1.45] ${
                  checked.has(i) ? "bg-(--tmd-accent-soft) text-(--tmd-fg)" : "text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
                }`}
                onClick={() => {
                  checked.has(i) ? checked.delete(i) : checked.add(i);
                  setChecked(new Set(checked));
                }}
              >
                <span
                  className={`mt-px box-content h-[13px] w-[13px] flex-none rounded-[3px] border ${
                    checked.has(i) ? "border-(--tmd-accent) bg-(--tmd-accent)" : "border-(--tmd-border-strong)"
                  } relative`}
                >
                  {checked.has(i) && (
                    <span className="absolute left-[3.5px] top-[0.5px] h-2 w-1 rotate-[42deg] border-b-2 border-r-2 border-(--tmd-accent-fg)" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="mr-1.5 rounded-[3px] border border-(--tmd-border) bg-(--tmd-bg-hover) px-1 py-px text-[0.625rem] text-(--tmd-fg-subtle)">
                    {t((CATEGORY_CN as Record<string, string>)[m.category] ?? m.category)}
                  </span>
                  {m.content}
                  <span className="ml-1.5 text-[0.625rem] text-(--tmd-fg-faint)">{m.category}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {injected && (
        <div className="flex-none truncate border-b border-(--tmd-border) px-2.5 py-1 text-[0.65625rem] text-(--tmd-accent)">
          {t("已注入 {n} 条为消息前缀,发送后 {cli} 将按项目约束执行。", { n: checkedCount, cli: profile?.name ?? t("当前 CLI") })}
        </div>
      )}
    </>
  );
}
