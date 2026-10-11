/**
 * 意图画布 · 索引落盘与读闸预算(自 documents.ts 拆出守行数铁则):
 * updatedAt 倒序排序(平局 id 决胜)+ 超限剥缩略图的增量精确预算。
 */
import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import type { IntentCanvasIndexEntry, IntentCanvasIndexFile } from "../types";
import { INTENT_CANVAS_INDEX_PATH, canvasDir } from "./paths";

/* 索引同受 fs_read_file 512KB 读闸:缩略图内联累积顶穿闸后索引恒读失败 →
   列表清空且保存中止索引更新(状态随保存恶化)。写前同款闸收敛:
   超限从最旧条目起剥缩略图(纯派生缓存,可重建,列表降级为占位图);剥光仍超限
   (元数据自身超阈,数千画布级)才拒写。 */
const MAX_INDEX_JSON_BYTES = 496 * 1024;

/** updatedAt 倒序;平局用 id 决胜(毫秒精度时间戳可同值,纯 `<`/`>` 比较器在
 *  相等时两方向同返回破坏反对称,并列条目顺序随引擎实现漂移——剥缩略图次序、
 *  AI 作画缺省目标 canvases[0]、时代分组分段都吃这个序)。 */
export function compareIndexEntries(left: IntentCanvasIndexEntry, right: IntentCanvasIndexEntry): number {
  return right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);
}

export async function writeIndex(root: string, entries: IntentCanvasIndexEntry[]): Promise<void> {
  const canvases = entries.slice().sort((left, right) => compareIndexEntries(left, right));
  const enc = new TextEncoder();
  const serialize = (list: IntentCanvasIndexEntry[]) =>
    JSON.stringify({ version: 1, canvases: list } satisfies IntentCanvasIndexFile, null, 2);
  let content = serialize(canvases);
  if (enc.encode(content).byteLength > MAX_INDEX_JSON_BYTES) {
    /* 条目在文件内的字节贡献 = 独立序列化每行 +4 空格缩进(canvases 数组项层级),
       逐条量「带图/去图」两次差值一遍扫完 O(n);条目间逗号(1B/条)未计 → 恒定
       微低估,方向安全:循环可能早停一张,最终整档重序列化精确复检兜底,绝不超限落盘。 */
    const embeddedBytes = (entry: IntentCanvasIndexEntry) =>
      enc.encode(JSON.stringify(entry, null, 2).split("\n").join("\n    ")).byteLength;
    const sizes = canvases.map(embeddedBytes);
    let remaining = enc.encode(content).byteLength;
    for (let i = canvases.length - 1; i >= 0 && remaining > MAX_INDEX_JSON_BYTES; i -= 1) {
      if (canvases[i].thumbnailSvg === undefined) continue;
      const stripped = { ...canvases[i] };
      delete stripped.thumbnailSvg;
      remaining += embeddedBytes(stripped) - sizes[i];
      canvases[i] = stripped;
    }
    content = serialize(canvases);
    if (enc.encode(content).byteLength > MAX_INDEX_JSON_BYTES) {
      throw new Error(t("画布索引超过存储读取上限(496KB),已拒绝写入,请删除部分画布后重试。"));
    }
  }
  await ipc.fsWriteFile(`${await canvasDir(root)}/${INTENT_CANVAS_INDEX_PATH}`, content);
}
