/**
 * CLI 前置依赖 —— 自 cli.ts 拆出(文件规模铁则)。
 * 被 CliProfile.requires 消费,声明安装/更新本 CLI 前必须就位的运行时。
 */

/**
 * 前置依赖(CliProfile.requires)—— 依赖自身的探针 binary 与安装通道声明,
 * 通道派生规则与主 CLI 一致(scriptInstall > commandInstall > npmPackage),
 * 见 welcome/engineMeta.ts 的 installPlanOf。
 */
export interface CliPrerequisite {
  /** 依赖的 binary 名(PATH 探针用),如 "bun"。 */
  binary: string;
  /** 展示名,如 "Bun"。 */
  name: string;
  /** 官方文档 URL;缺省 = 引导区不显示链接。 */
  docsUrl?: string;
  /** 官方脚本安装通道(优先):unix/windows 为完整命令串。 */
  scriptInstall?: { unix: string; windows: string };
  /** 命令通道安装(program + args 原样)。 */
  commandInstall?: { program: string; args: string[] };
  /** npm 包名:registry 最新版查询 + npm 通道兜底安装共用。 */
  npmPackage?: string;
}
