/**
 * lucide Pin v1.39.0(ISC)内联 —— 图标底座已统一 phosphor,扎点维持 lucide 造型
 * (2026-09-06 用户定向,勿在图标清理中 phosphor 化;见 workspace-sessions-extras.css
 * 的 .is-on fill 机制,stroke 型 SVG fill 即实心)。
 * 顶栏会话 tab 与侧栏行共用:自 plugins/workspace/SessionRows 沉淀进 kernel(跨层共享原语)。
 */
export function PinIcon({ size, className }: { size: number | string; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </svg>
  );
}
