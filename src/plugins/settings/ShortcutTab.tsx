/**
 * 基础设置 / 快捷键 tab —— codemoss 双栏编排:左 = 搜索 + 分组命令清单(ShortcutList),
 * 右 = 选中命令详情 + 录制(ShortcutDetail)。
 *
 * 数据源:`@kernel/shortcuts` 的 `useCommands()` 响应式注册表(内部已订阅覆盖层版本);
 * `ovVersion` 显式入 groups memo 依赖,保证「按键位标签搜索」在改键后用新标签重滤。
 * 写入:单项/全部重置走 `updateSettings({ shortcutOverrides })`(settings 内部 sanitize
 * 并喂入覆盖层,无需二次 setShortcutOverrides)。
 */
import { useEffect, useMemo, useState } from "react";
import { useCommands } from "@kernel/shortcuts";
import { getShortcutOverridesSnapshot, useShortcutOverridesVersion } from "@kernel/shortcutOverrides";
import { t } from "@kernel/i18n";
import { host } from "@kernel/host";
import { updateSettings } from "@kernel/settings";
import { CommandList } from "./ShortcutList";
import { filterCommands, groupCommandsByIdPrefix } from "./shortcutListModel";
import { DetailPanel } from "./ShortcutDetail";

/** 单项重置:删除该命令的覆盖,回到默认键位。 */
function resetOne(id: string): void {
  const overrides = { ...getShortcutOverridesSnapshot() };
  delete overrides[id];
  updateSettings({ shortcutOverrides: overrides });
}

/** 全部重置:清空覆盖表。 */
function resetAll(): void {
  updateSettings({ shortcutOverrides: {} });
}

export function ShortcutTab() {
  const commands = useCommands();
  const ovVersion = useShortcutOverridesVersion();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nameByPluginId] = useState(() => {
    const map = new Map<string, string>();
    for (const { plugin } of host.listPluginStates()) {
      map.set(plugin.id, plugin.meta.name);
    }
    return map;
  });

  const groups = useMemo(() => {
    const all = groupCommandsByIdPrefix(commands, nameByPluginId);
    return filterCommands(all, query);
    // ovVersion:改键后 effectiveLabel 变化,键位标签搜索需重滤
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commands, nameByPluginId, query, ovVersion]);

  // 默认选中第一条命令(让右栏始终有内容)
  useEffect(() => {
    if (selectedId && groups.some((g) => g.commands.some((c) => c.id === selectedId))) return;
    setSelectedId(groups[0]?.commands[0]?.id ?? null);
  }, [groups, selectedId]);

  const selected = useMemo(
    () => commands.find((c) => c.id === selectedId) ?? null,
    [commands, selectedId],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("搜索命令、键位或 id…")}
          className="h-8 w-full rounded-md border border-(--tmd-border) bg-(--tmd-bg-input) px-3 text-xs text-(--tmd-fg) outline-none placeholder:text-(--tmd-fg-faint) focus:border-(--tmd-accent)"
        />
        <button
          type="button"
          data-testid="shortcut-reset-all"
          onClick={resetAll}
          className="shortcut-reset"
        >
          {t("全部重置")}
        </button>
      </div>
      {groups.length === 0 ? (
        <div className="pref-card px-4 py-6 text-center text-xs text-(--tmd-fg-faint)">
          {t("没有匹配的命令")}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <CommandList groups={groups} selectedId={selectedId} onSelect={setSelectedId} />
          {selected ? (
            <DetailPanel cmd={selected} onReset={() => resetOne(selected.id)} />
          ) : null}
        </div>
      )}
    </div>
  );
}
