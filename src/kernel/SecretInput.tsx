/**
 * SecretInput —— 密钥输入(kernel 通用 UI 原语):默认掩码,眼睛切换明文。
 * 样式类 cli-cfg-* 由全局 styles/cli-config-controls.css 提供(app 级样式表)。
 * 消费:cli-config 表单/渠道对话框、cli-omp 自定义供应商弹层。
 */

import { useState } from "react";
import { Eye, EyeClosed } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";

/** 密钥输入:默认掩码,眼睛切换明文。 */
export function SecretInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="cli-cfg-secret">
      <input
        id={id}
        type={show ? "text" : "password"}
        className="cli-cfg-input"
        value={value}
        aria-label={t("密钥")}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="cli-cfg-icon-btn"
        aria-label={show ? t("隐藏") : t("显示")}
        onClick={() => setShow(!show)}
      >
        {/* R7 归档:钮内图标 13px→14px,size 统一 rem 字符串 */}
        {show ? <Eye size="0.875rem" /> : <EyeClosed size="0.875rem" />}
      </button>
    </div>
  );
}
