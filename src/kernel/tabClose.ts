/**
 * 用户手势关闭协调器 —— kernel tab 条 ×、右键菜单(关闭/关闭其他/关闭全部)、
 * ⌘W 的统一入口。
 *
 * 为什么单开一层而不把闸塞进 closeTab:tabs.ts 的 closeTab/closeOtherTabs/
 * closeAllTabs 是**同步删除面**,被大量程序性路径消费(文件删除后收 tab、
 * 面板 toggle 收起、测试装配)——那些场景问「要不要丢稿」没有意义,且改造
 * 成 async 会污染全部调用方。本模块只承担用户手势语义:先问该 kind 的
 * beforeClose 闸,放行才落同步删除面。
 *
 * 纪律(2026-10-13 立,收口上轮遗留「内核 dirty tab 关闭确认契约」):
 * - 未注册 beforeClose 的 kind 行为零变化(缺省放行);
 * - 闸抛错按**不放行**处理(保留 tab)—— 静默丢稿不可逆,保留 tab 可重试;
 * - 同一 tab 的在途确认共享一个 Promise,连点 ×/⌘W 不叠弹窗;
 * - 陈旧确认不删新实例(确认期间该 id 被关掉又重开,引用已换);
 * - 批量关闭逐个过闸,拒绝/异常者保留(不因一个 dirty tab 卡住整批,也不
 *   因整批放行而漏问)。**逐个是串行的,不并行**——每次 ask 可能弹一个模态
 *   确认,并行会同时叠出多个弹窗、用户分不清哪个对应哪个 tab;故本文件的
 *   `await` 出现在循环里是有意为之,已在 doctor.config.json 按仓内既有先例
 *   (cli-shared/mcpFormat.ts、sessionHead.ts)登记 async-await-in-loop 豁免。
 */
import {
  closeTab,
  getTab,
  getTabCloseGuard,
  getTabs,
  type EditorTab,
} from "./tabs";

/** 在途确认(键 = tab id):同 tab 重复手势复用同一个 Promise。 */
const inFlight = new Map<string, Promise<boolean>>();

/** 问一次闸:无闸 → 放行;拒绝/抛错 → 不放行。 */
function ask(tab: EditorTab): Promise<boolean> {
  const guard = getTabCloseGuard(tab.kind);
  if (!guard) return Promise.resolve(true);
  const pending = inFlight.get(tab.id);
  if (pending) return pending;
  const p = (async () => {
    try {
      return (await guard(tab)) !== false;
    } catch (e) {
      console.warn("[tabClose] beforeClose 闸异常,保留 tab", e);
      return false;
    }
  })();
  inFlight.set(tab.id, p);
  void p.then(() => {
    if (inFlight.get(tab.id) === p) inFlight.delete(tab.id);
  });
  return p;
}

/** 该 tab 是否仍是当前那个实例(确认期间可能已被关掉又重开)。 */
function stillCurrent(tab: EditorTab): boolean {
  return getTab(tab.id) === tab;
}

/** 关一个 tab(用户手势)。返回是否真关掉。 */
export async function requestCloseTab(id: string): Promise<boolean> {
  const tab = getTab(id);
  if (!tab) return false;
  if (!(await ask(tab))) return false;
  if (!stillCurrent(tab)) return false;
  closeTab(id);
  return true;
}

/** 关其他 tab(用户手势):keepId 恒保留,其余逐个过闸,拒绝者留下。 */
export async function requestCloseOtherTabs(keepId: string): Promise<void> {
  for (const tab of [...getTabs()]) {
    if (tab.id === keepId) continue;
    if (!(await ask(tab))) continue;
    if (!stillCurrent(tab)) continue;
    closeTab(tab.id);
  }
}

/** 关全部 tab(用户手势):逐个过闸,拒绝者留下。 */
export async function requestCloseAllTabs(): Promise<void> {
  for (const tab of [...getTabs()]) {
    if (!(await ask(tab))) continue;
    if (!stillCurrent(tab)) continue;
    closeTab(tab.id);
  }
}
