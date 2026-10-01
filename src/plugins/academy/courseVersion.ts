/**
 * 课程版本漂移判定(纯函数,单测面)—— audit B5 收口:
 * sourceVersion(课程数据提取时的源 CLI 版本)与装机引擎探针版本比对,
 * 不一致返回漂移信息(消费方出提示条,不阻断);一致或任一缺失 = null 不提示。
 */
export interface CourseVersionDrift {
  /** 课程数据提取时锁定的源 CLI 版本(sourceVersion 原文)。 */
  source: string;
  /** 装机引擎探针版本(cli_probe 原文)。 */
  installed: string;
}

/** 归一:去 v/V 前缀与首尾空白(cli_probe 与课程数据的书写形态差异)。 */
function normalize(v: string): string {
  return v.trim().replace(/^v/i, "");
}

export function courseVersionDrift(
  sourceVersion: string,
  installed: string | null | undefined,
): CourseVersionDrift | null {
  if (!sourceVersion || !installed) return null;
  if (normalize(sourceVersion) === normalize(installed)) return null;
  return { source: sourceVersion, installed };
}
