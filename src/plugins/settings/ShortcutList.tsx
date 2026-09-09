/**
 * 快捷键 tab 左栏:命令清单(搜索/分组/行)—— ShortcutTab 拆出的纯展示半区(300 行铁则)。
 *
 * 导出 `CommandGroup`/`groupCommandsByIdPrefix`/`filterCommands`/`effectiveLabel` 供
 * ShortcutTab(编排)与 ShortcutDetail(大键帽标签)复用;行内「已修改/内置」徽章、
 * 键帽 chip、「未设置」文案都在此。
 */
import { formatKeybinding, type CommandContribution } from "@kernel/shortcuts";
import { getShortcutOverridesSnapshot, isShortcutRemappable } from "@kernel/shortcutOverrides";
import { t } from "@kernel/i18n";

const SHELL_GROUP_NAME = "外壳与终端";

export interface CommandGroup {
  name: string;
  commands: CommandContribution[];
}

/** 命令清单按 id 前缀分组;组按首次出现顺序(id 字典序)稳定排列。 */
export function groupCommandsByIdPrefix(
  commands: readonly CommandContribution[],
  nameByPluginId: ReadonlyMap<string, string>,
): CommandGroup[] {
  const groups = new Map<string, CommandGroup>();
  for (const cmd of commands) {
    const dot = cmd.id.indexOf(".");
    const prefix = dot === -1 ? cmd.id : cmd.id.slice(0, dot);
    const name = nameByPluginId.get(prefix) ?? SHELL_GROUP_NAME;
    let group = groups.get(name);
    if (!group) {
      group = { name, commands: [] };
      groups.set(name, group);
    }
    group.commands.push(cmd);
  }
  return [...groups.values()];
}

/** effective 键位展示标签:label > effective keybinding > 未绑定(null)。 */
export function effectiveLabel(cmd: CommandContribution): string | null {
  const overrides = getShortcutOverridesSnapshot();
  const overridden = overrides[cmd.id];
  if (overridden === "") return null;
  if (overridden !== undefined) return formatKeybinding(overridden);
  if (cmd.keybindingLabel) return cmd.keybindingLabel;
  if (cmd.keybinding) return formatKeybinding(cmd.keybinding);
  return null;
}

/** 大小写不敏感匹配:标题 / 命令 id / 键位标签三者任一命中即保留。 */
export function filterCommands(
  groups: CommandGroup[],
  query: string,
): CommandGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  const hit = (cmd: CommandContribution): boolean => {
    const label = effectiveLabel(cmd) ?? "";
    return (
      cmd.title.toLowerCase().includes(q) ||
      cmd.id.toLowerCase().includes(q) ||
      label.toLowerCase().includes(q)
    );
  };
  return groups
    .map((g) => ({ name: g.name, commands: g.commands.filter(hit) }))
    .filter((g) => g.commands.length > 0);
}

/** 键帽芯片(对齐既有 KeyCap 视觉)。 */
function KeyCap({ label }: { label: string }) {
  return (
    <kbd className="inline-flex shrink-0 items-center rounded-[4px] border border-(--tmd-border) bg-(--tmd-bg-input) px-1.5 py-0.5 font-mono text-[0.6875rem] leading-none text-(--tmd-fg-muted)">
      {label}
    </kbd>
  );
}

/** 左侧分组命令清单行。 */
function CommandListItem({
  cmd,
  selected,
  onSelect,
}: {
  cmd: CommandContribution;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const overrides = getShortcutOverridesSnapshot();
  const hasOverride = cmd.id in overrides;
  // 仅 match 型(⌘1-9 等区间键)不可改写;无默认键位的命令允许录制,不挂徽章
  const builtin = cmd.match !== undefined && !isShortcutRemappable(cmd.id);
  const label = effectiveLabel(cmd);
  return (
    <button
      type="button"
      data-testid={`shortcut-row-${cmd.id}`}
      onClick={() => onSelect(cmd.id)}
      className={`shortcut-row pref-row${selected ? " is-selected" : ""}`}
    >
      <div className="min-w-0 flex-1">
        <div className="pref-title flex items-center gap-1.5">
          <span className="truncate">{t(cmd.title)}</span>
          {hasOverride ? (
            <span
              className="rounded-sm bg-(--tmd-accent-soft) px-1 text-[0.625rem] text-(--tmd-accent)"
              title={t("已修改")}
            >
              {t("已修改")}
            </span>
          ) : null}
          {builtin ? (
            <span
              className="rounded-sm bg-(--tmd-bg-hover) px-1 text-[0.625rem] text-(--tmd-fg-faint)"
              title={t("此命令为内置键位,不可改")}
            >
              {t("内置")}
            </span>
          ) : null}
        </div>
        <div className="truncate text-[0.625rem] text-(--tmd-fg-faint) font-mono">
          {cmd.id}
        </div>
      </div>
      {label ? <KeyCap label={label} /> : (
        <span className="shrink-0 text-xs text-(--tmd-fg-faint)">{t("未设置")}</span>
      )}
    </button>
  );
}

/** 左侧命令清单(分组 + 搜索 + 已选高亮)。 */
export function CommandList({
  groups,
  selectedId,
  onSelect,
}: {
  groups: CommandGroup[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2 overflow-y-auto">
      {groups.map((g) => (
        <div key={g.name} className="pref-card overflow-hidden">
          <div className="flex items-baseline justify-between px-4 pt-3 pb-1">
            <span className="text-[0.6875rem] tracking-widest text-(--tmd-fg-faint)">
              {t(g.name)}
            </span>
            <span className="text-[0.6875rem] text-(--tmd-fg-faint)">
              {g.commands.length}
            </span>
          </div>
          {g.commands.map((cmd) => (
            <CommandListItem
              key={cmd.id}
              cmd={cmd}
              selected={cmd.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
