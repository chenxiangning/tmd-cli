/**
 * tmd-lint 插件 —— 规则文件体检(独立工具 tmd-lint 移植落地)。
 *
 * - 数据面:各 cli-* profile 声明的 memoryFiles 为体检目标(声明式,零路径
 *   知识),会话语料经各 profile 的 listSessions/readSessionTranscript 声明
 *   适配器采集,本插件不懂任何 CLI 私有格式。
 * - 判定面:证据测量保持确定性(触达/纠正/照做,IDF 区分度门槛),「是否
 *   生效」的语义判断交本机 CLI 一次性 print 会话跑大模型实时判定
 *   (prompt-enhancer 同款范式);机器把关(pre-commit)与已拍板指纹确定性
 *   先行,不烧模型。
 * - 写回面:先备份 .bak-tmdlint 再落笔,行级操作带原文匹配守卫;
 *   归档迁 docs/agents-archive.md。
 */

import { Pulse } from "@phosphor-icons/react";
import "./locales"; /* 域词典随插件自带:i18n.registerMessages(import 即注册) */
import type { Plugin } from "@kernel/plugin";
import { LintPanel } from "./LintPanel";

export const tmdLintPlugin: Plugin = {
  id: "tmd-lint",
  meta: {
    name: "规则体检",
    abbr: "TL",
    desc: "对话日志体检规则文件,AI 逐条判定是否真的生效",
    icon: Pulse,
    iconColor: "#C25E5E",
    category: "feature",
  },
  permissions: ["ipc.terminal", "ipc.fs.read", "ipc.fs.write"],
  activate(ctx) {
    ctx.registerFilePanel({
      id: "tmd-lint",
      label: "规则体检",
      icon: Pulse,
      component: LintPanel,
      order: 33, /* memory-files(32)旁:同管记忆/规则文件面,生态组 */
      railGroup: "ecosystem",
      railBottom: true,
    });
  },
};
