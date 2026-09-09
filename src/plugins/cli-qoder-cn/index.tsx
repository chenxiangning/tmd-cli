import { makeQoderPlugin } from "../cli-shared/qoderSessions";

/**
 * Qoder CLI(国内版)插件(本机 qoderclicn 1.1.28 实证,2026-09-02):
 * - 与国际版(cli-qoder)同构,只差分发渠道:二进制 qoderclicn、数据目录 ~/.qoder-cn
 *   (npm @qodercn-ai/qoderclicn,docs.qoder.cn;登录/模型面/openapi 域名互相独立)。
 * - `/` 内置 skill 原生 /name 语法,纯透传;`@`/`$` 未实证,不声明(不猜接口)。
 * - 会话恢复 --resume <uuid>;历史列表扫 ~/.qoder-cn/projects/<slug>/。
 */

/** 国内版分发渠道:二进制名 + 数据目录。 */
export const QODER_CN_VARIANT = {
  profileId: "qoder-cn",
  command: "qoderclicn",
  dataDir: ".qoder-cn",
} as const;

export const cliQoderCnPlugin = makeQoderPlugin({
  id: "cli-qoder-cn",
  meta: { name: "Qoder CN", abbr: "QC", desc: "Qoder CLI 国内版引擎:磁盘会话、模型状态" },
  docsUrl: "https://docs.qoder.cn",
  npmPackage: "@qodercn-ai/qoderclicn",
  ...QODER_CN_VARIANT,
});
