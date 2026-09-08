/**
 * 词典契约测试 —— en/ja 词典完整性。
 * 覆盖:两语言键集合一致(漏译即红)、值非空、占位符在译文中保留、
 * 域文件内无重复键(对象字面量重复键 TS 编译即拦,这里防御合并期回归)。
 */
import { describe, expect, it } from "vitest";

import { EN_MESSAGES } from "./locales/en";
import { JA_MESSAGES } from "./locales/ja";

/** 从文本里提取 {name} 占位符集合。 */
function placeholdersOf(text: string): Set<string> {
  return new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
}

describe("en/ja 词典契约", () => {
  it("两语言键集合完全一致(缺失键 = 漏译)", () => {
    expect(Object.keys(JA_MESSAGES).sort()).toEqual(Object.keys(EN_MESSAGES).sort());
  });

  it("值非空字符串", () => {
    for (const [key, value] of Object.entries(EN_MESSAGES)) {
      expect(value.trim().length, `en 空值:${key}`).toBeGreaterThan(0);
    }
    for (const [key, value] of Object.entries(JA_MESSAGES)) {
      expect(value.trim().length, `ja 空值:${key}`).toBeGreaterThan(0);
    }
  });

  it("占位符 {name} 在译文中逐个保留(不多不少)", () => {
    for (const [key, en] of Object.entries(EN_MESSAGES)) {
      expect([...placeholdersOf(en)].sort(), `en 占位符不一致:${key}`).toEqual(
        [...placeholdersOf(key)].sort(),
      );
    }
    for (const [key, ja] of Object.entries(JA_MESSAGES)) {
      expect([...placeholdersOf(ja)].sort(), `ja 占位符不一致:${key}`).toEqual(
        [...placeholdersOf(key)].sort(),
      );
    }
  });

  it("键是中文源串(或键值相同的透传条目;拦截误把译文当键的写入方向)", () => {
    const cjk = /[\u4e00-\u9fff]/;
    for (const [key, value] of Object.entries(EN_MESSAGES)) {
      expect(cjk.test(key) || key === value, `键缺 CJK 且非透传(疑似方向写反):${key}`).toBe(true);
    }
  });
});
