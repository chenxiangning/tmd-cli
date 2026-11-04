/**
 * 非核心能力默认停用迁移(批次 H 可选化的承接形态)——
 * anim(动画项目)/ports(端口面板)/intent-canvas(意图画布)从默认启用改为
 * 默认停用:一次性把三个 id 追加进 disabledPlugins(插件市场可插回,重启生效),
 * marker 键 optionalPluginsDefaultOff 保证只执行一次——用户事后手动插回
 * 不会被下次启动重新拔掉。
 *
 * 承接形态决策(2026-11-05):不移除内置注册、不建外部包,走「默认停用 +
 * 市场可插回」——三个插件贡献面大(chips/快捷键/轮询/深链),代码保留
 * 可随时无损回滚,用户数据(~/.tmd-anim、~/.tmd-cli/intent-canvas 等)不动。
 */

/** 本批默认停用的非核心能力插件 id(与 allPlugins 注册的 id 一致)。 */
export const OPTIONAL_PLUGINS_DEFAULT_OFF: readonly string[] = ["anim", "ports", "intent-canvas"];

export type RetirableSettings = {
  disabledPlugins: string[];
  optionalPluginsDefaultOff: boolean;
};

/**
 * 一次性迁移(纯函数):marker 未立 → 追加停用清单并立 marker;
 * 已立 → 原样返回(引用相等,调用方据此刻判断是否需立即落盘)。
 */
export function applyOptionalPluginsRetirement<T extends RetirableSettings>(settings: T): T {
  if (settings.optionalPluginsDefaultOff) return settings;
  return {
    ...settings,
    disabledPlugins: [...new Set([...settings.disabledPlugins, ...OPTIONAL_PLUGINS_DEFAULT_OFF])],
    optionalPluginsDefaultOff: true,
  };
}
