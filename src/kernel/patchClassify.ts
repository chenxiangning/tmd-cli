/**
 * unified patch 行分类(kernel 通用原语,0.4.2 批三收敛):
 * checkpoints BatchFileSection 与 footprint DiffPanel 曾各持一份前缀梯子,
 * 且都把 `--- `头/`\ No newline`错分成 del/ctx —— 收敛为一份语义,镜像
 * git patchModel.parsePatch 的判定表(该文件是有状态真源,带行号配对,
 * 不强并;本函数面向无行号需求的轻量渲染)。
 *
 * ponytail: 无状态实现,删除行内容恰以 "-- "开头时会被误判 meta(git 自身
 * 靠 hunk 位置消歧);轻量面可接受,git 面板继续走 patchModel。
 */

export type PatchLineKind = "add" | "del" | "hunk" | "meta" | "ctx";

/** 头部/元信息前缀(git unified 产出集;判定先于 +/-,防 `--- a/x` 入 del)。 */
const META_PREFIXES = [
  "diff --git ",
  "index ",
  "--- ",
  "+++ ",
  "similarity index ",
  "dissimilarity index ",
  "rename ",
  "copy ",
  "new file mode ",
  "deleted file mode ",
  "old mode ",
  "new mode ",
  "Binary files ",
  "GIT binary patch",
] as const;

/** 一行 unified patch → 渲染分类。 */
export function classifyPatchLine(line: string): PatchLineKind {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("\\")) return "meta";
  for (const p of META_PREFIXES) {
    if (line.startsWith(p)) return "meta";
  }
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "ctx";
}
