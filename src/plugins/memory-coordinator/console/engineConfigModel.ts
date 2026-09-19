/**
 * 引擎配置模型 —— 上游 magic-context.jsonc 实证项的读/序列化/文件读写。
 * 自 EngineConfigCard.tsx 拆出(only-export-components 铁则),卡片只留组件。
 */

import { ipc } from "@kernel/ipc";
import { engineConfigPath } from "../paths";
// cli-shared 消费声明:本 feature 插件经共享层消费 CLI 配置 JSONC 格式知识(见 jsonc.ts 头注)。
import { parseJsoncOrNull } from "../../cli-shared/jsonc";
import { applyEdits, modify, parseTree, type JSONPath } from "jsonc-parser";

export interface EngineConfig {
  historianModel: string;
  dreamerModel: string;
  sidekickModel: string;
  sidekickEnabled: boolean;
  embeddingEnabled: boolean;
}

function pickModel(block: unknown): string {
  if (block && typeof block === "object") {
    const omp = (block as Record<string, unknown>).omp as Record<string, unknown> | undefined;
    const pi = (block as Record<string, unknown>).pi as Record<string, unknown> | undefined;
    const any = (omp ?? pi) as Record<string, unknown> | undefined;
    return typeof any?.model === "string" ? any.model : "";
  }
  return "";
}

function readEngineConfig(raw: Record<string, unknown> | null): EngineConfig {
  return {
    historianModel: pickModel(raw?.historian),
    dreamerModel: pickModel(raw?.dreamer),
    sidekickModel: pickModel(raw?.sidekick),
    sidekickEnabled: raw?.sidekick !== undefined,
    embeddingEnabled: true,
  };
}

/** jsonc 写回统一排版(与旧 JSON.stringify(base, null, 2) 缩进一致)。 */
const ENGINE_CONFIG_FMT = { formattingOptions: { tabSize: 2, insertSpaces: true } };

/** 删除顶层属性(保注释)。jsonc-parser 的 modify 删除会吞掉被删属性前后间隙里的
 * 注释行,与「写回保注释」承诺冲突;这里按语法树偏移做纯区间手术:只删
 * [属性起点, 值终点] 与紧随其后的分隔逗号(尾属性则吃前导逗号;前导间隙混有
 * 注释时放弃吃逗号,留可容忍的尾逗号),连同属性行缩进一并清掉不留残行。
 * 找不到属性时原样返回。 */
function removeTopLevelProperty(text: string, key: string): string {
  const root = parseTree(text);
  if (!root || root.type !== "object" || !root.children) return text;
  const prop = root.children.find(
    (c) => c.type === "property" && c.children?.[0]?.value === key,
  );
  if (!prop) return text;
  let start = prop.offset;
  let end = prop.offset + prop.length;
  const comma = /^[ \t]*,([ \t]*\r?\n)?/.exec(text.slice(end));
  if (comma) {
    end += comma[0].length;
  } else {
    const gap = /[ \t\r\n]*$/.exec(text.slice(0, start))?.[0] ?? "";
    if (text[start - gap.length - 1] === "," && !gap.includes("/")) {
      start = start - gap.length - 1;
    }
  }
  while (start > 0 && (text[start - 1] === " " || text[start - 1] === "\t")) start -= 1;
  return text.slice(0, start) + text.slice(end);
}

/** jsonc 逐叶写入一个 model 值;父级是标量(异型行,如 "historian": "str")时
 * jsonc 拒插 → 把最近异型祖先替换成空对象后重写(对齐旧实现「异型按 {} 处理」)。 */
function writeModelLeaf(text: string, block: string, harness: string, model: string): string {
  const path: JSONPath = [block, harness, "model"];
  try {
    return applyEdits(text, modify(text, path, model, ENGINE_CONFIG_FMT));
  } catch {
    for (let cut = path.length - 1; cut >= 1; cut--) {
      try {
        text = applyEdits(text, modify(text, path.slice(0, cut), {}, ENGINE_CONFIG_FMT));
        break;
      } catch {
        /* 再上一层 */
      }
    }
    return applyEdits(text, modify(text, path, model, ENGINE_CONFIG_FMT));
  }
}

/** 引擎配置 → 可写回的 jsonc 文本(per-harness:pi 为基座,omp 回退 pi,opencode 独立)。
 * 用 jsonc-parser 逐叶 edit:原文里用户手写注释与既有字段(如 extra、主题块)原样保留,
 * 只有目标 model 值的字节被替换 —— 旧实现 parseJsoncOrNull→JSON.stringify 整文件重写会
 * 静默抹掉全部注释。sidekick 开关与「块在否」同构:开=写块,关=删块(读侧块在即开,
 * 不删块则关闭永不落盘);embedding 为上游默认无开关,恒不写。
 * 原文非法 JSONC → 回落 "{}" 干净重建(旧语义)。 */
function serializeEngineConfig(config: EngineConfig, original: string | null): string {
  let text = original && original.trim() && parseJsoncOrNull(original) !== null ? original : "{}";
  const blocks: Array<[string, string]> = [
    ["historian", config.historianModel],
    ["dreamer", config.dreamerModel],
    ...(config.sidekickEnabled ? [["sidekick", config.sidekickModel] as [string, string]] : []),
  ];
  for (const [block, model] of blocks) {
    for (const harness of ["pi", "omp", "opencode"] as const) {
      text = writeModelLeaf(text, block, harness, model);
    }
  }
  if (!config.sidekickEnabled) {
    text = removeTopLevelProperty(text, "sidekick");
  }
  return text.endsWith("\n") ? text : `${text}\n`;
}

export async function readEngineConfigFile(): Promise<{ config: EngineConfig; original: string }> {
  const p = await engineConfigPath();
  const original = await ipc.fsReadFile(p).catch(() => "");
  return { config: readEngineConfig(parseJsoncOrNull(original)), original };
}

export async function writeEngineConfigFile(
  config: EngineConfig,
  original: string | null,
): Promise<void> {
  const p = await engineConfigPath();
  await ipc.fsWriteFile(p, serializeEngineConfig(config, original));
}
