/**
 * treeIcons —— 工作区树的细线图标(工作区 UI 照桌面侧栏图样,大仙 2026-09-25):
 * 全部 1.5 stroke / round cap,与桌面侧栏线条风格一致。纯展示,无状态。
 * chevron 方向按大仙指定基准图(展开=上尖);桌面 WorkspaceCard 相反,手机刻意独立。
 */
export function ChevronIcon(props: { open: boolean; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={props.size ?? 14} height={props.size ?? 14} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {props.open ? <path d="M3.5 10 8 5.5 12.5 10" /> : <path d="M3.5 6 8 10.5 12.5 6" />}
    </svg>
  );
}

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
