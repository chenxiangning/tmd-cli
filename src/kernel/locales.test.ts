/**
 * 词典契约测试 —— en/ja 词典完整性。
 * 覆盖:两语言键集合一致(漏译即红)、值非空、占位符在译文中保留、
 * 域文件内无重复键(对象字面量重复键 TS 编译即拦,这里防御合并期回归)、
 * 跨域同键异值(合并 spread 后者静默覆盖前者,0.3.5「关闭」Off/Close 撞车即此类)。
 */
import { describe, expect, it } from "vitest";

import { EN_MESSAGES } from "./locales/en";
import { JA_MESSAGES } from "./locales/ja";
import { MESSAGES as enCommon } from "./locales/en/common";
import { MESSAGES as enSettings } from "./locales/en/settings";
import { MESSAGES as enSettings2 } from "./locales/en/settings2";
import { MESSAGES as enWorkspace } from "./locales/en/workspace";
import { MESSAGES as enGit } from "./locales/en/git";
import { MESSAGES as enFiles } from "./locales/en/files";
import { MESSAGES as enCli } from "./locales/en/cli";
import { MESSAGES as enCli2 } from "./locales/en/cli2";
import { MESSAGES as enComposer } from "./locales/en/composer";
import { MESSAGES as enSsh } from "./locales/en/ssh";
import { MESSAGES as enWsl } from "./locales/en/wsl";
import { MESSAGES as enAssets } from "./locales/en/assets";
import { MESSAGES as enMisc } from "./locales/en/misc";
import { MESSAGES as enMisc2 } from "./locales/en/misc2";
import { MESSAGES as enMobile } from "./locales/en/mobile";
import { MESSAGES as enTime } from "./locales/en/time";
import { MESSAGES as enMarket } from "./locales/en/market";
import { MESSAGES as jaCommon } from "./locales/ja/common";
import { MESSAGES as jaSettings } from "./locales/ja/settings";
import { MESSAGES as jaSettings2 } from "./locales/ja/settings2";
import { MESSAGES as jaWorkspace } from "./locales/ja/workspace";
import { MESSAGES as jaGit } from "./locales/ja/git";
import { MESSAGES as jaFiles } from "./locales/ja/files";
import { MESSAGES as jaCli } from "./locales/ja/cli";
import { MESSAGES as jaCli2 } from "./locales/ja/cli2";
import { MESSAGES as jaComposer } from "./locales/ja/composer";
import { MESSAGES as jaSsh } from "./locales/ja/ssh";
import { MESSAGES as jaWsl } from "./locales/ja/wsl";
import { MESSAGES as jaAssets } from "./locales/ja/assets";
import { MESSAGES as jaMisc } from "./locales/ja/misc";
import { MESSAGES as jaMisc2 } from "./locales/ja/misc2";
import { MESSAGES as jaMobile } from "./locales/ja/mobile";
import { MESSAGES as jaTime } from "./locales/ja/time";
import { MESSAGES as jaMarket } from "./locales/ja/market";

/** 从文本里提取 {name} 占位符集合。 */
function placeholdersOf(text: string): Set<string> {
  return new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
}

/** 域展开合并序(与 locales/{en,ja}/index.ts 的 spread 序一致;同键异值时后者静默覆盖前者)。 */
const EN_DOMAINS: [string, Record<string, string>][] = [
  ["common", enCommon], ["settings", enSettings], ["settings2", enSettings2],
  ["workspace", enWorkspace], ["git", enGit], ["files", enFiles],
  ["cli", enCli], ["cli2", enCli2], ["composer", enComposer],
  ["ssh", enSsh], ["wsl", enWsl], ["assets", enAssets], ["misc", enMisc],
  ["misc2", enMisc2], ["mobile", enMobile], ["time", enTime], ["market", enMarket],
];
const JA_DOMAINS: [string, Record<string, string>][] = [
  ["common", jaCommon], ["settings", jaSettings], ["settings2", jaSettings2],
  ["workspace", jaWorkspace], ["git", jaGit], ["files", jaFiles],
  ["cli", jaCli], ["cli2", jaCli2], ["composer", jaComposer],
  ["ssh", jaSsh], ["wsl", jaWsl], ["assets", jaAssets], ["misc", jaMisc],
  ["misc2", jaMisc2], ["mobile", jaMobile], ["time", jaTime], ["market", jaMarket],
];

/** 扫同键异值:同键同译的跨域覆盖无害(有意共享),异值即某域 UI 被静默改写。 */
function domainConflicts(domains: [string, Record<string, string>][]): string[] {
  const seen: Record<string, string> = {};
  const problems: string[] = [];
  for (const [name, map] of domains) {
    for (const [key, value] of Object.entries(map)) {
      if (seen[key] !== undefined && seen[key] !== value) {
        problems.push(`键「${key}」:${name}="${value}" 覆盖先前的="${seen[key]}"`);
      }
      seen[key] = value;
    }
  }
  return problems;
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

  it("en 跨域同键异值为零(撞键须消歧或同译,禁止静默覆盖)", () => {
    expect(domainConflicts(EN_DOMAINS)).toEqual([]);
  });

  it("ja 跨域同键异值为零(撞键须消歧或同译,禁止静默覆盖)", () => {
    expect(domainConflicts(JA_DOMAINS)).toEqual([]);
  });
});
