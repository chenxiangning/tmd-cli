/**
 * treeIcons —— 工作区树的细线图标(工作区 UI 照桌面侧栏图样,大仙 2026-09-25):
 * 全部 1.5 stroke / round cap,与桌面侧栏线条风格一致。纯展示,无状态。
 */

export function FolderIcon(props: { open?: boolean; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={props.size ?? 15} height={props.size ?? 15} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {props.open ? (
        <path d="M1.8 13V3.6c0-.6.4-1 1-1h3l1.6 1.8h5.8c.6 0 1 .4 1 1v1.2M1.8 13h11l1.4-4.2c.2-.6-.2-1.2-.9-1.2H4.3c-.5 0-.9.3-1 .7L1.8 13Z" />
      ) : (
        <path d="M1.8 13V3.6c0-.6.4-1 1-1h3l1.6 1.8h5.8c.6 0 1 .4 1 1V13H1.8Z" />
      )}
    </svg>
  );
}

/** 本地 tab 图标(显示器线条)。 */
export function LocalIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="1.8" y="2.5" width="12.4" height="8.4" rx="1.4" />
      <path d="M5.5 13.5h5M8 10.9v2.6" strokeLinecap="round" />
    </svg>
  );
}

/** 归档 tab 图标(盒线)。 */
export function ArchiveIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="2" y="4.5" width="12" height="8.6" rx="1.4" />
      <path d="M2 7.5h12M5.5 4.5 4 7.5" strokeLinecap="round" />
    </svg>
  );
}

/** 选中行尾对勾(sheet 整行选中态;1.8 stroke 保 14px 尺度下的辨识度)。 */
export function CheckIcon(props: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={props.size ?? 14} height={props.size ?? 14} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m3.5 8.6 3 3 6-7.2" />
    </svg>
  );
}

/** 分支图标(Git 面板入口钮;1.5 stroke 同族)。 */
export function GitIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <circle cx="4.5" cy="3.5" r="1.9" />
      <circle cx="4.5" cy="12.5" r="1.9" />
      <circle cx="11.5" cy="5.5" r="1.9" />
      <path d="M4.5 5.4v5.2M11.5 7.4c0 2.4-3 2.6-5.2 3.4" />
    </svg>
  );
}

/** 加号图标(新建会话/工作区内发起)。 */
export function PlusIcon(props: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={props.size ?? 13} height={props.size ?? 13} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <path d="M8 3.2v9.6M3.2 8h9.6" />
    </svg>
  );
}

/** 刷新图标(手动重扫;旋转动画由消费方 WAAPI 驱动)。 */
export function RefreshIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M13.2 6.6A5.5 5.5 0 0 0 3 5.4M2.8 9.4a5.5 5.5 0 0 0 10.2 1.2" />
      <path d="M13.4 2.6v4h-4M2.6 13.4v-4h4" />
    </svg>
  );
}
