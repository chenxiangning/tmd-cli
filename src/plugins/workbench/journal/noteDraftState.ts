import type { DayNoteImage } from "./journalFiles";

/** 只接收当前编辑代次的贴图结果;基于调用时的最新图片集追加,不用旧闭包覆盖。 */
export function mergePastedImage(
  images: readonly DayNoteImage[],
  image: DayNoteImage,
  epoch: number,
  currentEpoch: number,
): DayNoteImage[] | null {
  return epoch === currentEpoch ? [...images, image] : null;
}
