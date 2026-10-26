/**
 * i18n 完整性门禁(项 2):扫全仓 literal t() 键,断言 en/ja 词典全量覆盖。
 * zh 恒等免查;模板串/变量键(动态键约定)豁免;测试文件与词典文件自身豁免。
 * 回归防线:新增文案漏译在此红,不再静默回落中文(en/ja 模式中文夹缝的根)。
 */
import { describe, expect, it } from "vitest";
import { dictionarySnapshot } from "./i18n";

/* side-effect:加载全部插件词典(registerMessages 注册面)。glob 模式覆盖
 * 插件单文件词典与词典目录两种形态(见 src/plugins 下 locales 布局)。 */
void import.meta.glob(
  ["/src/plugins/**/locales.ts", "/src/plugins/**/locales/*.ts", "!**/*.test.*"],
  { eager: true },
);

const KEY_RE = /\bt\(\s*("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/g;

const rawFiles = import.meta.glob(
  ["/src/**/*.ts", "/src/**/*.tsx", "!**/*.test.*", "!**/locales*/**", "!**/locales.ts"],
  { eager: true, query: "?raw", import: "default" },
) as unknown as Record<string, string>;

describe("i18n 完整性:literal t() 键 en/ja 全覆盖", () => {
  it("源码 literal 键都有 en 与 ja 译文", () => {
    const dict = dictionarySnapshot();
    const files = Object.keys(rawFiles);
    expect(files.length).toBeGreaterThan(100); // glob 生效自证
    const missing: string[] = [];
    for (const path of files) {
      const src = rawFiles[path];
      let m: RegExpExecArray | null;
      KEY_RE.lastIndex = 0;
      while ((m = KEY_RE.exec(src))) {
        const raw = m[1];
        const key = raw[0] === "'" ? raw.slice(1, -1) : JSON.parse(raw);
        if (!(key in dict.en)) missing.push(`en  ${path}: ${key}`);
        if (!(key in dict.ja)) missing.push(`ja  ${path}: ${key}`);
      }
    }
    expect(
      `缺译 ${missing.length} 条(前 40):\n${missing.slice(0, 40).join("\n")}`,
    ).toBe(`缺译 0 条(前 40):\n`);
  });
});
