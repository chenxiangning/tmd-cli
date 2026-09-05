/**
 * GitOpTokens —— 命令/目标摘要的着色 token 流(复刻 codemoss GitOperationTokens)。
 * token 间默认以空格分隔,`separatorBefore: ""` 可去掉(拼 `origin:main` 这类紧贴形式)。
 * 着色语义:command=accent / operator=弱化 / remote=插入绿 / branch=警示黄 / option=品红。
 */

import type { ReactNode } from "react";

export type GitOpTokenKind = "command" | "operator" | "remote" | "branch" | "option";

export interface GitOpToken {
  kind: GitOpTokenKind;
  value: string;
  separatorBefore?: string;
}

const KIND_CLASS: Record<GitOpTokenKind, string> = {
  command: "font-semibold text-(--tmd-accent)",
  operator: "text-(--tmd-fg-faint)",
  remote: "font-medium text-(--tmd-diff-inserted)",
  branch: "font-medium text-(--tmd-warn)",
  option: "font-medium text-fuchsia-500/90",
};

export function GitOpTokens({
  tokens,
  className = "",
}: {
  tokens: GitOpToken[];
  className?: string;
}) {
  return (
    <span translate="no" className={`font-mono text-xs ${className}`}>
      {tokens.map((t, i) => (
        <span key={i} className={KIND_CLASS[t.kind]}>
          {t.separatorBefore ?? (i > 0 ? " " : "")}
          {t.value}
        </span>
      ))}
    </span>
  );
}

/** 对话框正文小节标题(Intent / Will Happen / Example 这类固定标签)。 */
export function OpSectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-xs font-semibold text-(--tmd-fg)">{children}</div>
  );
}
