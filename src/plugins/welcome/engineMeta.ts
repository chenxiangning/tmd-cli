/**
 * 欢迎页引擎元数据 —— 从已注册 CliProfile 派生,零静态表。
 *
 * 展示/安装元数据(docsUrl / npmPackage / scriptInstall)是 CliProfile 的
 * 声明字段(同 renderIcon 性质),本模块只做形状适配;展示名取引擎插头
 * 自声明的 plugin.meta.name(按 plugin.id = `cli-${profile.id}` 约定 join,
 * 见 kernel/plugin.ts 的 id 约定)。
 * 新增 CLI 引擎 = 只走标准路径(新建插件目录 + allPlugins 一行),本文件不动。
 */

import { host } from "@kernel/host";
import type { CliProfile } from "@kernel/cli";
import type { CliInstallPlan } from "@kernel/ipc";

export interface EngineMeta {
  /** CliProfile.id(omp / pi / codex / claude ...)。 */
  id: string;
  /** UI 展示名(引擎插头 meta.name,如 "Codex CLI")。 */
  displayName: string;
  /** 探针的 binary 名(PATH 中查找用)= profile.command。 */
  binary: string;
  /** 官方文档 URL(profile.docsUrl);缺省 = 不显示链接。 */
  docsUrl?: string;
  /** 安装方式说明(按钮旁提示文本),由安装通道派生。 */
  installHint: string;
  /** npm 包名(registry 最新版查询用);脚本通道引擎也可声明(仅查版本)。 */
  npmPackage?: string;
  /** 参数化安装计划;null = 该引擎未声明安装通道(不出安装按钮)。 */
  plan: CliInstallPlan | null;
}

/** 安装计划派生:scriptInstall 优先(官方脚本),否则 npm 通道。 */
export function installPlanOf(profile: CliProfile): CliInstallPlan | null {
  if (profile.scriptInstall) {
    return { channel: "script", ...profile.scriptInstall };
  }
  if (profile.npmPackage) {
    return { channel: "npm", package: profile.npmPackage };
  }
  return null;
}

/** 引擎插头展示名:plugin.id = `cli-${profile.id}` 约定的 join。 */
function engineDisplayName(profile: CliProfile): string {
  const plugin = host
    .listPluginStates()
    .find((p) => p.plugin.id === `cli-${profile.id}`);
  return plugin?.plugin.meta.name ?? profile.id;
}

/** 单个 profile → 引擎卡元数据。 */
export function engineMetaOf(profile: CliProfile): EngineMeta {
  return {
    id: profile.id,
    displayName: engineDisplayName(profile),
    binary: profile.command,
    docsUrl: profile.docsUrl,
    npmPackage: profile.npmPackage,
    installHint: profile.scriptInstall
      ? profile.scriptInstall.unix
      : profile.npmPackage
        ? `npm install -g ${profile.npmPackage}`
        : "",
    plan: installPlanOf(profile),
  };
}

/** 全部已注册引擎(顺序 = profile 注册顺序 = allPlugins 顺序)。 */
export function engineMetas(): EngineMeta[] {
  return host.getCliProfiles().map(engineMetaOf);
}
