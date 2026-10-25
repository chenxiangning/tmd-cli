/**
 * git 错误分类 —— 匹配 kernel/ipc.ts 注释的 E_* 前缀契约。
 * 归一化/剥码原语下沉 kernel/errText.ts(0.4.5 错误呈现层统一),本件只留 git 域判定。
 */
import { errTextCode, errTextDisplay, errTextMessage } from "@kernel/errText";

export function gitErrorMessage(e: unknown): string {
  return errTextMessage(e);
}

export function isNotARepo(e: unknown): boolean {
  return errTextCode(e) === "NOT_A_REPO";
}

export function isAuth(e: unknown): boolean {
  return errTextCode(e) === "AUTH";
}

/** 展示文案:剥掉 E_* 前缀,保留后端原始描述。 */
export function gitErrorDisplay(e: unknown): string {
  return errTextDisplay(e);
}
