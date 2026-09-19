/**
 * remoteReport —— 远端操作完成通知的明细文案(fetch/pull/push 共用,纯函数):
 * 已是最新 / 推送 N 个提交 / 合入 N 个提交 + 文件变更(+i -d) / 更新 N 个远端引用。
 */

import { t } from "@kernel/i18n";
import type { GitRemoteOpReport } from "@kernel/ipc";

/** 完成通知文案:op 决定取哪些字段;label 是已翻译的操作名(获取/拉取/推送)。 */
export function formatRemoteReport(
  op: "fetch" | "pull" | "push",
  label: string,
  r: GitRemoteOpReport,
): string {
  if (op === "fetch") {
    return r.upToDate
      ? t("{op}成功:远端引用已是最新。", { op: label })
      : t("{op}成功:更新 {n} 个远端引用。", { op: label, n: r.refs });
  }
  if (op === "push") {
    return r.upToDate
      ? t("{op}成功:远端已是最新。", { op: label })
      : t("{op}成功:已推送 {n} 个提交。", { op: label, n: r.commits });
  }
  if (r.upToDate) return t("{op}成功:已是最新。", { op: label });
  const files = t("{f} 个文件变更(+{i} -{d})", { f: r.files, i: r.insertions, d: r.deletions });
  /* --squash / 快进不了的 --no-commit 场景:有文件变更但提交数为 0。 */
  return r.commits > 0
    ? t("{op}成功:合入 {c} 个提交,{files}。", { op: label, c: r.commits, files })
    : t("{op}成功:{files}。", { op: label, files });
}
