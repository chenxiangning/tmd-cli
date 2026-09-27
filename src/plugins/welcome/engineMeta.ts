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
import type { CliInstallPlan, CliProbeResult } from "@kernel/ipc";

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
  /** 就地自更新通道(profile.commandUpdate 透传);仅更新,不当安装通道。 */
  commandUpdate?: { program: string; args: string[] };
  /** 「版本」菜单开关(profile.versionMenu 且 command 通道可钉版时才为真)。 */
  versionMenu: boolean;
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

/** 探针感知的安装计划解析:更新谁由探针命中的副本决定(2026-09-11 双副本
 * 遮蔽修复,npm 布局识别在内核 probe_cli,npmPrefix 随探针返回)。
 * - 命中副本为 npm 拥有(npmPrefix 非空)且声明通道非 script → npm 计划,
 *   安装器加 --prefix 就地更新探针看到的那份(omp 声明 bun 通道但 PATH 前位
 *   是 npm 副本时,bun 更新永远更不到探针命中的副本);
 * - 其余(未装/非 npm 副本/声明 script)→ 声明计划(script > command > npm):
 *   声明 script 的引擎走官方原生分发(claude/kimi),只有官方脚本管得了
 *   原生副本,npm 覆盖会写一份探针看不到的新副本;
 * - 探针命中非 npm 副本且声明通道是 npm:更新永远写探针看不到的新副本
 *   (2026-09-25 qoder 实证,原生版本化目录自管)→ 声明了 commandUpdate
 *   (CLI 自带 update 子命令)则走命令通道就地自更新,否则声明计划原样。 */
export function resolveInstallPlan(
  meta: Pick<EngineMeta, "plan" | "npmPackage" | "commandUpdate">,
  probe: CliProbeResult | null | undefined,
): CliInstallPlan | null {
  if (meta.plan?.channel !== "script" && meta.npmPackage && probe?.npmPrefix) {
    return { channel: "npm", package: meta.npmPackage };
  }
  if (
    probe?.found &&
    !probe.npmPrefix &&
    meta.plan?.channel === "npm" &&
    meta.commandUpdate
  ) {
    return { channel: "command", ...meta.commandUpdate };
  }
  return meta.plan;
}

/**
 * 钉版安装计划:command 通道 args 中 === npmPackage 的项替换为 `pkg@version`
 * (如 `bun install -g @oh-my-pi/pi-coding-agent` → `…@18.1.20`)。
 * 无法钉版(非 command 通道 / 未声明包名 / args 不含包名)→ null(不出版本菜单)。
 * npm 通道钉版要动 Rust(InstallPlan::Npm 硬编码 @latest),本特性不做(spec 方案取舍 B)。
 */
export function pinPlanVersion(
  plan: CliInstallPlan | null,
  npmPackage: string | undefined,
  version: string,
): CliInstallPlan | null {
  if (!plan || plan.channel !== "command" || !npmPackage) return null;
  const pinned = `${npmPackage}@${version}`;
  let replaced = false;
  const args = plan.args.map((a) => {
    if (a !== npmPackage) return a;
    replaced = true;
    return pinned;
  });
  return replaced ? { channel: "command", program: plan.program, args } : null;
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
function engineMetaOf(profile: CliProfile): EngineMeta {
  const req = profile.requires;
  const plan = installPlanOf(profile);
  return {
    id: profile.id,
    displayName: engineDisplayName(profile),
    binary: profile.command,
    docsUrl: profile.docsUrl,
    npmPackage: profile.npmPackage,
    installHint: installHintOf(profile),
    plan,
    commandUpdate: profile.commandUpdate,
    versionMenu:
      profile.versionMenu === true && plan?.channel === "command" && !!profile.npmPackage,
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
