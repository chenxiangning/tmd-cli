/**
 * 关窗闸编排(0.4.0 项 12)—— 红 X / 系统关窗(onCloseRequested)的统一编排,
 * 自 quitGuard.tsx 迁出(组件文件只留 QuitDialog,Fast Refresh 才能安全保态):
 * 有脏 tab 先聚合确认一次(不串行逐个问),整体裁决后走 requestCloseAllTabs
 * 退出模式强制放行(绕各 kind 闸),镜像 flush 先行兜底跨强退恢复;取消则
 * 什么都不做,窗口原样保留。web 态在 ipc 原语处短路。
 *
 * ⌘Q 应用退出腿(0.4.1 批三落地,0.4.0 批二 review 裁决路线):tauri-runtime-wry
 * ExitRequested{code:None} 仅来自最后窗口 Destroyed(prevent=僵尸进程),
 * macOS(tao 0.37)无 applicationShouldTerminate,⌘Q 根本不发 ExitRequested
 * —— Rust 侧无可靠挂点;故走菜单装配(macOS 自定义 Quit 菜单项 accel,点击只
 * 发 tmd://menu-quit 事件,无默认退出行为,天然规避僵尸进程)。
 *
 * 「本次不再问」是内存标志(本次运行有效,不持久):勾选后本运行的后续
 * 关窗直接放行,镜像照常 flush(崩溃网不撤)。
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { getTabs } from "./tabs";
import { draftMirrorFlushAll } from "./draftMirror";
import { onMenuQuitRequested, onWindowCloseRequest, windowClose } from "./ipc";
import { requestCloseAllTabs } from "./tabClose";
import { planQuit } from "./quitGuardPlan";
import { QuitDialog, type QuitEntry } from "./quitGuard";

/** 命令式挂载(askDialog 同款临时 root;quitGuard 无常驻组件宿主)。
 *  .ts 无 JSX,createElement 与 JSX 编译产物同构(quitGuard.test 同手法)。 */
function openQuitDialog(
  entries: readonly QuitEntry[],
  onConfirm: (dontAsk: boolean) => void,
  onCancel: () => void,
): void {
  if (typeof document === "undefined") return;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const close = () => {
    /* 卸载延后一拍:同步卸载自家 root 会打断 React 事件派发(askDialog 先例)。 */
    setTimeout(() => {
      root.unmount();
      host.remove();
    }, 0);
  };
  root.render(
    createElement(QuitDialog, {
      entries,
      onConfirm: (dontAsk) => {
        close();
        onConfirm(dontAsk);
      },
      onCancel: () => {
        close();
        onCancel();
      },
    }),
  );
}

/** 「本次不再问」:内存标志,本次运行有效(重启恢复询问,跨强退安全网不撤)。 */
let skipAskThisRun = false;
/** 在途弹层共享:连点关窗不叠弹。 */
let dialogOpen = false;

/** prevent:拦窗语义(关窗事件 preventDefault;菜单腿无事件可拦,传 noop)。
 *  proceed:不拦时的出口——关窗腿走原生流程自走(不调);菜单腿无原生流程,
 *  须显式关窗(单窗 destroyed → 进程退)。 */
function quitRequested(prevent: () => void, proceed: () => void): void {
  draftMirrorFlushAll(); /* 同帧补写:弹层/放行前镜像先落,窗口真关也不丢 */
  const dirty = getTabs().filter((tab) => tab.dirty);
  const finish = () => void windowClose();
  if (planQuit(dirty.length, skipAskThisRun) === "noop") {
    proceed(); /* 关窗腿 = 不拦(原生关闭流程自走);菜单腿 = 主动关窗 */
    return;
  }
  prevent();
  if (dialogOpen) return;
  dialogOpen = true;
  openQuitDialog(
    dirty.map((tab) => ({ id: tab.id, title: tab.title, kind: tab.kind })),
    (dontAsk) => {
      dialogOpen = false;
      if (dontAsk) skipAskThisRun = true;
      /* 强制放行通道:绕各 kind 闸(退出已整体裁决),结算等待后补发关闭。 */
      void requestCloseAllTabs({ quit: true }).then(finish);
    },
    () => {
      dialogOpen = false; /* 取消:preventDefault 已拦下,窗口原样保留 */
    },
  );
}

let booted = false;

/** app-shell 启动时挂一次:订阅关窗意图 + ⌘Q 菜单退出意图(0.4.1 批三)。 */
export function bootQuitGuard(): void {
  if (booted) return;
  booted = true;
  onWindowCloseRequest((prevent) => quitRequested(prevent, () => undefined));
  /* 菜单腿:不拦 = 不退出(无事件发生);无脏 = 主动关窗 → 单窗 destroyed → 进程退;
   * 确认后仍走 requestCloseAllTabs({quit:true}) 统一结算链。 */
  onMenuQuitRequested(() => quitRequested(() => undefined, () => void windowClose()));
}
