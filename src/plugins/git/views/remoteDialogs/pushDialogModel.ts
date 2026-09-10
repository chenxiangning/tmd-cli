/**
 * PushDialog 模型层 —— 纯函数与 hook(only-export-components:组件文件只留组件)。
 */

import { useState } from "react";
import { type GitOpToken } from "./GitOpTokens";

/** 目标仅在候选集变化或远端切换时纠正一次:渲染期 prev-leafs 对比直接调校。
 *  与旧 effect 等价(只在 leafs 引用变化时触发),但不再多出一次 stale 提交;
 *  手输目标分支因 leafs 不变不会被拉回候选首项。 */
export function useSyncTargetToLeafs(leafs: string[], target: string, setTarget: (t: string) => void) {
  const [prevLeafs, setPrevLeafs] = useState(leafs);
  if (prevLeafs !== leafs) {
    setPrevLeafs(leafs);
    if (leafs.length > 0 && !leafs.includes(target.trim())) setTarget(leafs[0]);
  }
}



/** hero tokens(<branch> -> <remote>:<target>,gerrit 时 target 换 refs/for 前缀)。 */
export function buildPushHeroTokens(
  branch: string,
  remote: string,
  target: string,
  gerrit: boolean,
): GitOpToken[] {
  const targetSummary = gerrit ? `refs/for/${target.trim() || branch}` : target.trim() || branch;
  return [
    { kind: "branch", value: branch || "HEAD" },
    { kind: "operator", value: "->" },
    { kind: "remote", value: remote.trim() || "origin" },
    { kind: "operator", value: ":", separatorBefore: "" },
    { kind: "branch", value: targetSummary, separatorBefore: "" },
  ];
}
