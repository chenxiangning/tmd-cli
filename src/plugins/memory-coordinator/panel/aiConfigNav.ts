/**
 * AI 配置首页导航定义(E-01 纯逻辑,组件文件不导出非组件铁则)——
 * 每张卡片的标题/描述/直达动作/禁用判定集中在此,AiConfigHome 只负责渲染。
 * 直达语义:引擎/智能体·提示词 = 设置 section 深链(cli-config、assets id 原样);
 * Skills/MCP = 各家 hubTab 幂等 open;Magic Context = 控制台中央 tab;
 * 记忆与规则 = 本面板视图切换(回调注入)。
 */

import { t } from "@kernel/i18n";
import { openSettingsPanel } from "@kernel/settings";
import { openSkillHubTab } from "@plugins/skill-hub/hubTab";
import { openMcpHubTab } from "@plugins/mcp-hub/hubTab";
import { openConsoleTab } from "../console/consoleTab";

export interface AiConfigEntry {
  /** 稳定 key(测试锚)。 */
  id: string;
  title: string;
  desc: string;
  onClick: () => void;
  /** 目标插件停用 → 禁用(原因用统一文案 offReason)。 */
  disabled?: boolean;
}

export interface AiConfigNav {
  entries: AiConfigEntry[];
  /** 目标插件停用时的统一禁用原因(渲染层展示)。 */
  offReason: string;
  /** 记忆与规则 = 本面板原生视图(文件/体检),不入 entries(渲染形制不同)。 */
  onShowFiles: () => void;
  onShowLint: () => void;
}

/** 组装首页导航;disabledPlugins = 设置里的停用插件清单(重启生效口径)。 */
export function buildAiConfigNav(
  disabledPlugins: readonly string[],
  host: { onShowFiles: () => void; onShowLint: () => void },
): AiConfigNav {
  const off = (id: string) => disabledPlugins.includes(id);
  const entry = (id: string, plugin: string | undefined, e: Pick<AiConfigEntry, "title" | "desc" | "onClick">): AiConfigEntry => ({
    id,
    ...e,
    disabled: plugin ? off(plugin) : undefined,
  });
  return {
    offReason: t("该插件已停用,在插件市场启用后重启生效"),
    entries: [
      entry("engines", "cli-config", {
        title: t("引擎配置"),
        desc: t("各 CLI 的本地配置文件:图形化编辑,保存写回原文件,未知内容原样保留。"),
        onClick: () => openSettingsPanel({ section: "cli-config", tab: "engines" }),
      }),
      entry("skills", "skill-hub", {
        title: "Skills" /* 专有面板名,各语言同形(hubTab 头注先例),不走词典 */,
        desc: t("跨引擎技能目录管理:扫描/预览/删除 + 技能商店安装落位。"),
        onClick: () => openSkillHubTab(),
      }),
      entry("mcp", "mcp-hub", {
        title: "MCP" /* 专有面板名,各语言同形 */,
        desc: t("跨引擎 MCP 配置写回管理:增删改直写各家配置文件,附三源商店与导入桥。"),
        onClick: () => openMcpHubTab(),
      }),
      entry("magic-context", undefined, {
        title: "Magic Context" /* 专有名词,各语言同形(控制台 tab 先例),不走词典 */,
        desc: t("共享记忆池:启用/安装迁移、写入与沉淀治理,经 omp 官方管线。"),
        onClick: () => openConsoleTab(),
      }),
      entry("assets", "assets", {
        title: t("智能体 / 提示词"),
        desc: t("可复用资产库:composer 里 !! 插入提示词,## 挂载智能体。"),
        onClick: () => openSettingsPanel({ section: "assets", tab: "agents" }),
      }),
    ],
    onShowFiles: host.onShowFiles,
    onShowLint: host.onShowLint,
  };
}
