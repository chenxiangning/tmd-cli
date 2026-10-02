/**
 * DSH 适配器运行时落盘 —— spawnTransform 前把 adapter/*.cjs 源码写到
 * ~/.tmd-cli/adapters/dsh/(在 fs 删除白名单内,清场删除可生效),
 * spawn 用落盘绝对路径(浏览器侧 __dirname 无意义)。
 * 源码经 vite ?raw 内联进 bundle,dev/prod 同源;版本戳变化才重写。
 */

import { ensureDir } from "@kernel/fsDirs";
import { ipc } from "@kernel/ipc";
import adapterSrc from "./adapter/dsh-adapter.cjs?raw";
import rpcSrc from "./adapter/dsh-rpc.cjs?raw";
import sessionSrc from "./adapter/dsh-session.cjs?raw";
import printSrc from "./adapter/dsh-print.cjs?raw";
import projectSrc from "./adapter/dsh-project.cjs?raw";
import themeSrc from "./adapter/dsh-theme.cjs?raw";
import renderSrc from "./adapter/dsh-render.cjs?raw";
import commandsSrc from "./adapter/dsh-commands.cjs?raw";
import menuSrc from "./adapter/dsh-menu.cjs?raw";
import menuhostSrc from "./adapter/dsh-menuhost.cjs?raw";
import keysSrc from "./adapter/dsh-keys.cjs?raw";
import clickSrc from "./adapter/dsh-click.cjs?raw";
import zoneSrc from "./adapter/dsh-zone.cjs?raw";
import pendingSrc from "./adapter/dsh-pending.cjs?raw";
import spinnerSrc from "./adapter/dsh-spinner.cjs?raw";
import footerSrc from "./adapter/dsh-footer.cjs?raw";
import streamSrc from "./adapter/dsh-stream.cjs?raw";
import turnSrc from "./adapter/dsh-turn.cjs?raw";
import thinkSrc from "./adapter/dsh-think.cjs?raw";

/** 入口文件名(dsh-adapter 的 spawnTransform 以绝对路径跑它)。 */
const ENTRY = "dsh-adapter.cjs";

const FILES: Record<string, string> = {
  [ENTRY]: adapterSrc,
  "dsh-rpc.cjs": rpcSrc,
  "dsh-session.cjs": sessionSrc,
  "dsh-print.cjs": printSrc,
  "dsh-project.cjs": projectSrc,
  "dsh-theme.cjs": themeSrc,
  "dsh-render.cjs": renderSrc,
  "dsh-commands.cjs": commandsSrc,
  "dsh-menu.cjs": menuSrc,
  "dsh-menuhost.cjs": menuhostSrc,
  "dsh-keys.cjs": keysSrc,
  "dsh-click.cjs": clickSrc,
  "dsh-zone.cjs": zoneSrc,
  "dsh-pending.cjs": pendingSrc,
  "dsh-spinner.cjs": spinnerSrc,
  "dsh-stream.cjs": streamSrc,
  "dsh-turn.cjs": turnSrc,
  "dsh-think.cjs": thinkSrc,
  "dsh-footer.cjs": footerSrc,
};

/** 版本戳:djb2 内容哈希,升级后自动重写落盘件(长度和会碰撞,不用)。 */
const STAMP = `v1-${djb2(Object.values(FILES).join("\n"))}`;

let ensured: Promise<string> | null = null;

/** 幂等落盘,返回适配器入口绝对路径;失败 reject 由 spawn 链路广播。
 *  失败不缓存:瞬时落盘失败(AV 锁/磁盘满)若把 rejected Promise 钉死在
 *  memo,整个运行期 dsh spawn 全灭(2026-09-28 评审 F1;stamp 幂等保证
 *  重跑无害,同 configCatalog「失败不缓存」惯例)。 */
export function ensureAdapterDeployed(): Promise<string> {
  if (!ensured) {
    ensured = deploy().catch((e) => {
      ensured = null;
      throw e;
    });
  }
  return ensured;
}

async function deploy(): Promise<string> {
  const home = await ipc.configHomeDir();
  const dir = `${home}/.tmd-cli/adapters/dsh`;
  const stampPath = `${dir}/.stamp`;
  /* 目录逐级建(kernel fsDirs 原语;已存在报错忽略)。 */
  await ensureDir(dir);
  const entry = `${dir}/${ENTRY}`;
  const old = await ipc.fsReadFile(stampPath).catch(() => "");
  /* stamp 命中还要确认入口文件真在:调试清场/被杀软隔离/手工截断后 stamp 仍在,
     只信 stamp 会让之后每次 dsh 对话 Cannot find module 秒退,直到应用版本变化。 */
  if (old.trim() === STAMP && (await ipc.fsReadFile(entry).catch(() => null)) !== null) return entry;
  /* 清场:删除不在清单里的旧 .cjs(重构删过件,残留会被旧 require 路径迷惑)。
     清场必须先于写入收口,且写 stamp 前清场/写入须全落地 —— 步骤间有依赖,
     用 reduce Promise 链保序(单步失败语义与 for-await 一致:中断后续)。 */
  const entries = await ipc.fsListDir(dir).catch(() => []);
  const stale = entries.filter((e) => e.name.endsWith(".cjs") && !(e.name in FILES));
  await stale.reduce<Promise<void>>(
    (p, e) => p.then(() => ipc.fsRemovePath(`${dir}/${e.name}`).catch(() => undefined)),
    Promise.resolve(),
  );
  await Object.entries(FILES).reduce<Promise<void>>(
    (p, [name, src]) => p.then(() => ipc.fsWriteFile(`${dir}/${name}`, src)),
    Promise.resolve(),
  );
  await ipc.fsWriteFile(stampPath, STAMP);
  return entry;
}

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
