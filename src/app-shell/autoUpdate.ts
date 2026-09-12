/**
 * 应用内自动更新 —— tauri-plugin-updater 一键「检查 + 下载 + 安装 + 重启」。
 *
 * 通道与分工:updater 插件走 GitHub Releases latest.json(minisign 签名产物,
 * 负责「装」);releases.atom 手动检查(updateCheck.ts,无限额)负责「发现」,
 * 两者互补。流程与 codemoss features/update 同款接法:
 * - Update 句柄存模块级,不进 React 态;被新检查取代的旧句柄显式 close,
 *   不泄漏已下载产物;
 * - check() 底层 reqwest 无默认超时,服务不可达时 Promise 永不落定 —— 包
 *   15s 超时视为失败;
 * - 代次守卫:并发触发时旧流程的迟到事件(进度/错误)整包丢弃;
 * - 端点短暂指向正在运行的版本(发布竞态)时不误导升级,归 latest。
 *
 * 浏览器 dev(无 Tauri runtime)直接落 error 态,由 ipc.hasNativeUpdater 分流。
 */

import {
  hasNativeUpdater,
  relaunchApp,
  updaterCheck,
  type Update,
} from "@kernel/ipc";
import { createSubscribable } from "@kernel/subscribable";
import { t } from "@kernel/i18n";

export type AutoUpdateStage =
  | "idle"
  | "checking"
  | "downloading"
  | "installing"
  | "restarting"
  | "latest"
  | "error";

export interface AutoUpdateState {
  stage: AutoUpdateStage;
  /** 待安装的更新版本(不带 v 前缀)。 */
  version: string | null;
  /** 下载进度 0-100;总量未知(无 content-length)为 null。 */
  percent: number | null;
  /** 失败原因(可直接展示;插件错误原文为英文,统一包中文引导)。 */
  error: string | null;
}

const CHECK_TIMEOUT_MS = 15_000;

const store = createSubscribable<AutoUpdateState>({
  stage: "idle",
  version: null,
  percent: null,
  error: null,
});

function patch(next: Partial<AutoUpdateState>): void {
  store.commit({ ...store.snapshot, ...next });
}

/** 插件句柄 / 流程代次 / 下载字节账:模块级,跨弹窗开合存活(下载中关弹窗
 *  再开,进度仍在);字节账与 codemoss 同口径(Started 定总量,Progress 累加)。 */
let pending: Update | null = null;
let generation = 0;
let downloadedBytes = 0;
let totalBytes: number | null = null;

function closeHandle(handle: Update | null): void {
  if (!handle) return;
  void handle.close().catch(() => undefined);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const { promise: result, resolve, reject } = Promise.withResolvers<T>();
  const timer = setTimeout(() => reject(new Error(t("更新检查超时"))), ms);
  promise.then(
    (value) => {
      clearTimeout(timer);
      resolve(value);
    },
    (error) => {
      clearTimeout(timer);
      reject(error);
    },
  );
  return result;
}

/** 一键自动更新:检查 → (有更新)下载 → 安装 → 重启。任何一步失败落 error
 *  态(reason 可直接展示);无更新落 latest。进行中重复调用为 no-op。 */
export function runAutoUpdate(): void {
  if (store.snapshot.stage === "checking" || store.snapshot.stage === "downloading") return;
  const myGen = ++generation;
  const stale = () => myGen !== generation;
  if (pending) {
    closeHandle(pending);
    pending = null;
  }
  downloadedBytes = 0;
  totalBytes = null;
  patch({ stage: "checking", version: null, percent: null, error: null });

  void (async () => {
    let update: Update | null = null;
    try {
      if (!hasNativeUpdater()) {
        throw new Error(t("当前为浏览器 dev 环境(无 Tauri runtime),无法自动更新。"));
      }
      update = await withTimeout(updaterCheck(), CHECK_TIMEOUT_MS);
      if (stale()) {
        closeHandle(update);
        return;
      }
      /* 端点发布竞态:端点指向正在运行的版本 = 无更新,不误导升级。 */
      if (!update) {
        patch({ stage: "latest" });
        return;
      }
      pending = update;
      patch({
        stage: "downloading",
        version: update.version.replace(/^v/i, ""),
        percent: null,
      });
      await update.downloadAndInstall((event) => {
        if (stale() || pending !== update) return;
        if (event.event === "Started") {
          totalBytes = event.data.contentLength ?? null;
          downloadedBytes = 0;
          patch({ percent: totalBytes ? 0 : null });
        } else if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          patch({
            percent: totalBytes
              ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
              : null,
          });
        } else if (event.event === "Finished") {
          patch({ stage: "installing" });
        }
      });
      if (stale()) return;
      patch({ stage: "restarting" });
      await relaunchApp();
    } catch (error) {
      if (stale()) return;
      closeHandle(pending);
      pending = null;
      const reason = error instanceof Error ? error.message : String(error);
      patch({ stage: "error", error: t("自动更新失败:{reason}", { reason }) });
    }
  })();
}

/** React 订阅;版本弹窗按快照渲染按钮态与进度。 */
export function useAutoUpdate(): AutoUpdateState {
  return store.useStore();
}
