/**
 * RPC 输入面触发符集 —— 从 ssComposer 拆出(组件文件只导出组件,守
 * react-doctor only-export-components):"/" 滤除,因 RPC tab 已有基于
 * getCommands 的专属命令补全,profile 的 "/" 触发符再激活会出现双下拉竞争。
 * 浅拷贝仅改 triggers,其余字段引用不变;无 "/" 的原样返回(引用不变,memo 友好)。
 */
import type { CliProfile } from "@kernel/cli";

export function rpcTriggerSpecs(profile: CliProfile | null): CliProfile | null {
  if (!profile?.triggers?.some((s) => s.char === "/")) return profile;
  return { ...profile, triggers: profile.triggers.filter((s) => s.char !== "/") };
}
