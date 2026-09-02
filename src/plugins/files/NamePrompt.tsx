/**
 * 文件树命名弹窗(新建文件/新建文件夹/重命名共用)—— 复刻 codemoss
 * FileTreePrompts:全屏 backdrop + 居中小卡片,Enter 确认 / Esc 取消,
 * 重命名预填旧名并全选;失败由父级保持弹窗开启并回显 promptError。
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function NamePrompt({
  title,
  parentPath,
  initialName,
  confirmLabel,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  /** 提示用父目录路径(新建场景)。 */
  parentPath?: string;
  /** 重命名预填旧名。 */
  initialName?: string;
  confirmLabel: string;
  error: string | null;
  onCancel: () => void;
  /** 提交裸文件名;失败不关弹窗(父级决定)。 */
  onConfirm: (name: string) => void;
}) {
  const [name, setName] = useState(initialName ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed) onConfirm(trimmed);
  };

  return createPortal(
    <div className="nprompt-backdrop" onMouseDown={onCancel}>
      <div
        className="nprompt-card"
        role="dialog"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="nprompt-title">{title}</div>
        {parentPath ? <div className="nprompt-parent">{parentPath}</div> : null}
        <input
          ref={inputRef}
          className="nprompt-input"
          value={name}
          placeholder="输入名称"
          spellCheck={false}
          aria-label={title}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
        />
        {error ? <div className="nprompt-error">⚠ {error}</div> : null}
        <div className="nprompt-actions">
          <button type="button" className="nprompt-btn" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="nprompt-btn is-primary"
            disabled={!name.trim()}
            onClick={submit}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
