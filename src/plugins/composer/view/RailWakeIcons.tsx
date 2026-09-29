/**
 * 输入轨唤醒双图标 —— composer.inputRail 贡献(order 60,assets 唤醒/广播/增强之后):
 * 技能(Sparkle)/ MCP(HardDrive)直达命令抽屉对应分区,图标与抽屉左缘 rail
 * 分区图标同源(轨图标 = 分区图标的锚点契约,spec 2026-09-28 评审 §0 准则 6)。
 *
 * 图标即能力探针(准则 1,隐藏优于置灰):
 * - 可见性 = declaredSections(profile) 命中 + 非远程引擎会话
 *   (isRemoteEngineSession:本机磁盘扫描对远端会话是无效数据);
 * - 点击 = toggleDrawerSection:关→开带落位;已开@他区→切区;已开@该区→关
 *   (与 ⌘K/工具条 toggle 惯例对齐,状态机契约见 state/drawerOpen.ts)。
 */

import { HardDrive, Sparkle } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { declaredSections } from "../drawerItems";
import {
  toggleDrawerSection,
  useDrawerOpen,
  useDrawerSection,
} from "../state/drawerOpen";
import { isRemoteEngineSession, useActiveProfile, useActiveSession } from "../state/useActiveProfile";

export function RailWakeIcons() {
  const profile = useActiveProfile();
  const session = useActiveSession();
  const open = useDrawerOpen();
  const activeSection = useDrawerSection();
  if (!profile || isRemoteEngineSession(session)) return null;
  const sections = declaredSections(profile);
  return (
    <>
      {sections.includes("skill") && (
        <RailBtn
          label={t("技能($)")}
          Icon={Sparkle}
          decorId="wake-skill"
          open={open}
          active={open && activeSection === "skill"}
          onClick={() => toggleDrawerSection("skill")}
        />
      )}
      {sections.includes("mcp") && (
        <RailBtn
          label={t("MCP 服务器")}
          Icon={HardDrive}
          decorId="wake-mcp"
          open={open}
          active={open && activeSection === "mcp"}
          onClick={() => toggleDrawerSection("mcp")}
        />
      )}
    </>
  );
}

function RailBtn({
  label,
  Icon,
  decorId,
  open,
  active,
  onClick,
}: {
  label: string;
  Icon: typeof Sparkle;
  decorId: string;
  open: boolean;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`composer-rail-btn${active ? " composer-rail-btn-active" : ""}`}
      title={label}
      aria-label={label}
      aria-controls="command-drawer"
      aria-expanded={open}
      onClick={onClick}
    >
      <Icon size="0.875rem" data-action-id={decorId} />
    </button>
  );
}
