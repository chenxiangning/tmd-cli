/**
 * 关窗闸编排(0.4.0 项 12)—— 红 X / 系统关窗 / ⌘Q 统一走 onCloseRequested 一条链:
 * 有脏 tab 先聚合确认一次(不串行逐个问),确认后走 requestCloseAllTabs 退出模式
 * 强制放行(绕各 kind 闸)并直接销毁窗口,镜像 flush 先行兜底跨强退恢复;
 * 取消则什么都不做,窗口原样保留。web 态在 ipc 原语处短路。
 *
 * ⌘Q 腿(0.4.1 批三装配,0.4.4 收口):macOS 应用菜单的自定义 Quit 项(accel
 * CmdOrControl+Q)点击后**只发关窗**(见 src-tauri/src/app_setup.rs),因此
 * ⌘Q 与红 X 在此汇成同一条链接管 —— 本文件不再有第二套「菜单退出」编排。
 * 旧形态(Rust 发 tmd://menu-quit 事件、前端再 windowClose)已拆:那一腿依赖
 * webview 接住事件,接不住就是哑键;关窗链则由壳侧兜底(前端未拦 = 原生销毁)。
 *
 * 「本次不再问」是内存标志(本次运行有效,不持久):勾选后本运行的后续
 * 关窗直接放行,镜像照常 flush(崩溃网不撤)。
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { getTabs } from "./tabs";
import { draftMirrorFlushAll } from "./draftMirror";
import { onWindowCloseRequest, windowDestroy } from "./ipc";
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

/** 关窗意图裁决:脏空/已勾「不再问」= 不拦(事件不 preventDefault,原生销毁自走);
 *  有脏 = 拦下弹聚合确认,确认后强关 tab 再直接销毁窗口,取消则窗口原样保留。 */
function quitRequested(prevent: () => void): void {
  draftMirrorFlushAll(); /* 同帧补写:弹层/放行前镜像先落,窗口真关也不丢 */
  const dirty = getTabs().filter((tab) => tab.dirty);
  if (planQuit(dirty.length, skipAskThisRun) === "noop") return;
  prevent();
  if (dialogOpen) return;
  dialogOpen = true;
  openQuitDialog(
    dirty.map((tab) => ({ id: tab.id, title: tab.title, kind: tab.kind })),
    (dontAsk) => {
      dialogOpen = false;
      if (dontAsk) skipAskThisRun = true;
      /* 强制放行通道:绕各 kind 闸(退出已整体裁决),结算等待后直接销毁窗口。 */
      void requestCloseAllTabs({ quit: true }).then(() => void windowDestroy());
    },
    () => {
      dialogOpen = false; /* 取消:preventDefault 已拦下,窗口原样保留 */
    },
  );
}

let booted = false;

/** app-shell 启动时挂一次:红 X / 系统关窗 / macOS ⌘Q 全汇到这一条关窗链。 */
export function bootQuitGuard(): void {
  if (booted) return;
  booted = true;
  onWindowCloseRequest((prevent) => quitRequested(prevent));
}
