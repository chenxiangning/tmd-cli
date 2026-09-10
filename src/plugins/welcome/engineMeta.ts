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
  /** 前置依赖(profile.requires 派生);缺省 = 无依赖,直接出安装按钮。 */
  requires?: PrerequisiteMeta;
}

/** 前置依赖元数据 —— binary/plan 形状与 EngineMeta 对齐,安装钩子复用同一套。 */
export interface PrerequisiteMeta {
  /** 依赖 binary 名(PATH 探针 + 安装事件 id 惯例)。 */
  binary: string;
  /** 展示名,如 "Bun"。 */
  name: string;
  /** 官方文档 URL;缺省 = 引导区不显示链接。 */
  docsUrl?: string;
  /** 安装方式说明,由依赖自己的安装通道派生。 */
  installHint: string;
  /** 依赖的安装计划;null = 未声明通道(只引导,不出安装按钮)。 */
  plan: CliInstallPlan | null;
}

/** 安装通道声明形状(CliProfile 与 CliPrerequisite 的共有子集)。 */
interface InstallChannels {
  npmPackage?: string;
  commandInstall?: { program: string; args: string[] };
  scriptInstall?: { unix: string; windows: string };
}

/** 安装计划派生:scriptInstall(官方脚本)> commandInstall > npm 通道。 */
export function installPlanOf(channels: InstallChannels): CliInstallPlan | null {
  if (channels.scriptInstall) {
    return { channel: "script", ...channels.scriptInstall };
  }
  if (channels.commandInstall) {
    return { channel: "command", ...channels.commandInstall };
  }
  if (channels.npmPackage) {
    return { channel: "npm", package: channels.npmPackage };
  }
  return null;
}

/** 安装方式提示(按钮旁说明):按通道派生,与 installPlanOf 同序。 */
function installHintOf(channels: InstallChannels): string {
  if (channels.scriptInstall) return channels.scriptInstall.unix;
  if (channels.commandInstall) {
    return [channels.commandInstall.program, ...channels.commandInstall.args].join(" ");
  }
  return channels.npmPackage ? `npm install -g ${channels.npmPackage}` : "";
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
  const req = profile.requires;
  return {
    id: profile.id,
    displayName: engineDisplayName(profile),
    binary: profile.command,
    docsUrl: profile.docsUrl,
    npmPackage: profile.npmPackage,
    installHint: installHintOf(profile),
    plan: installPlanOf(profile),
    requires: req
      ? {
          binary: req.binary,
          name: req.name,
          docsUrl: req.docsUrl,
          installHint: installHintOf(req),
          plan: installPlanOf(req),
        }
      : undefined,
  };
}

/** 全部已注册引擎(注册顺序,唯 dsh 沉底:基础设施型引擎,host 面板最长,
 *  放末尾不打断引擎行列表的阅读动线)。 */
export function engineMetas(): EngineMeta[] {
  const metas = host.getCliProfiles().map(engineMetaOf);
  return [...metas.filter((m) => m.id !== "dsh"), ...metas.filter((m) => m.id === "dsh")];
}
