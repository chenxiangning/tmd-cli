/**
 * 错误横幅原语(错误呈现层二期)—— 129 处裸透收编后的统一展示件:
 * 剥 E_ 码显示摘要,可展开原始详情(带码全文,排查 Rust 侧原始报错用)。
 * 无码错误退化为纯文本(与既有行为一致);域分类文案由消费方按
 * errTextCode 自行映射(先例:git 域 gitErrorDisplay)。
 */

import { errTextDisplay } from "@kernel/errText";

export function ErrorBanner(props: { error: string | null; onDismiss?: () => void }) {
  if (!props.error) return null;
  const hasCode = /^E_[A-Z_]+:/.test(props.error);
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-(--tmd-radius-sm) border border-(--tmd-diff-deleted)/40 bg-(--tmd-diff-deleted)/10 px-2.5 py-1.5 text-xs text-(--tmd-fg)"
    >
      <span className="min-w-0 flex-1 break-words">
        {errTextDisplay(props.error)}
        {hasCode && (
          <details className="mt-1 text-(--tmd-fg-muted)">
            <summary className="cursor-pointer select-none">原始详情</summary>
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-[11px]">
              {props.error}
            </pre>
          </details>
        )}
      </span>
      {props.onDismiss && (
        <button
          type="button"
          aria-label="关闭"
          className="shrink-0 text-(--tmd-fg-muted) hover:text-(--tmd-fg)"
          onClick={props.onDismiss}
        >
          ×
        </button>
      )}
    </div>
  );
}
