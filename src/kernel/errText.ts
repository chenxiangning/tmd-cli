/**
 * Rust 错误文本统一出口(0.4.5 错误呈现层第一步)—— 错误码前缀契约
 * (E_*: 见 git 域先例与 ipc.ts 注释)的三原语:归一化 / 剥码展示 / 取码。
 *
 * 展示律:默认剥 E_* 码显原文;调用方按码映射本地化分类文案(gitErrorDisplay
 * 切换到本件;anim read-failed 的 locale 感知抑制同宗)。新增 Rust 错误一律
 * 带 `E_CODE:` 前缀,前端经 errTextCode 分类、errTextDisplay 出正文。
 */

/** 归一化:Tauri Err(String) 到前端是 Error(message) 或裸 string。 */
export function errTextMessage(e: unknown): string {
 if (e instanceof Error) return e.message;
 return String(e);
}

/** 剥掉 E_* 码前缀的展示文本(无码原样返回)。 */
export function errTextDisplay(e: unknown): string {
 return errTextMessage(e).replace(/^E_[A-Z_]+:\s*/, "");
}

/** 取 E_* 码(无码 = null;码不含 E_ 前缀本身)。 */
export function errTextCode(e: unknown): string | null {
 const m = errTextMessage(e).match(/^E_([A-Z_]+):/);
 return m ? m[1] : null;
}
