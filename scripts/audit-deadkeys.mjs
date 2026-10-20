/**
 * i18n 死键人工核对脚本(0.4.1 批四 · 2026-10-20)—— check:i18n-keys 的死键
 * 告警只扫 t("字面量") 直引,数组/变量经 t(label) 消费的键全部误报。
 * 本脚本对指定词典文件逐键做全码出现扫描:键的中文在非词典源码中出现 =
 * 动态引用(活键);完全无出现 = 真死候选(再人工确认)。
 *
 * 用法:node scripts/audit-deadkeys.mjs [词典文件...](缺省 = 告警最密四域)
 */
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { execSync } from "node:child_process";

const targets = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "src/plugins/footprint/locales/en.ts",
      "src/plugins/memory-coordinator/locales/en.ts",
      "src/plugins/workbench/journal/locales/en.ts",
      "src/plugins/workbench/locales/en-docgen.ts",
      "src/plugins/workbench/locales/en.ts",
    ];

/** 词典文件 -> 键 列表(顶层 "键": 形态)。 */
function dictKeys(path) {
  const keys = [];
  for (const ln of readFileSync(path, "utf8").split("\n")) {
    const m = ln.match(/^\s*"(.*?)"\s*:/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

/** 非词典源码(键的中文在此出现 = 动态引用)。 */
const srcFiles = execSync("find src -name '*.ts' -o -name '*.tsx'", { encoding: "utf8" })
  .split("\n")
  .filter((p) => p && !p.includes("/locales/") && !/locales\.ts$/.test(p));
const srcMap = new Map(
  srcFiles.map((p) => {
    try {
      return [p, readFileSync(p, "utf8")];
    } catch {
      return [p, ""];
    }
  }),
);

let totalDead = 0;
for (const target of targets) {
  const keys = dictKeys(target);
  const dead = [];
  for (const k of keys) {
    let hit = null;
    for (const [p, txt] of srcMap) {
      if (txt.includes(k)) {
        hit = p;
        break;
      }
    }
    if (!hit) dead.push(k);
    else console.log(`  活 ${k.slice(0, 40)}  <- ${hit}`);
  }
  totalDead += dead.length;
  console.log(`== ${target}: 词典 ${keys.length} 键,真死候选 ${dead.length} ==`);
  for (const k of dead) console.log(`  死 ${k}`);
}
console.log(`\n合计真死候选:${totalDead}(需人工确认后才能在词典中删除)`);
