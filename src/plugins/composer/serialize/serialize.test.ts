/**
 * composer serialize 序列化管线契约测试。
 * 覆盖:findActiveTrigger 光标边界、translatePrompt 全量变换/透传、
 * prepareSendPayload 的 CR 追加,以及无触发符文本的恒等透传(模块无反序列化
 * 对应物,单向管线的"往返"不变量 = 不含触发符的原文原样通过)。
 */
import { describe, expect, it } from "vitest";

import type { CliProfile, CliTriggerSpec } from "@kernel/cli";

import { findActiveTrigger, prepareSendPayload, translatePrompt } from "./serialize";

const DOLLAR: CliTriggerSpec = {
  char: "$",
  kind: "skill",
  translate: (token) => "/skill:" + token.slice(1),
};
const SLASH: CliTriggerSpec = { char: "/", kind: "command" };
const AT: CliTriggerSpec = { char: "@", kind: "file" };

function profileOf(triggers: CliTriggerSpec[]): CliProfile {
  return { id: "test", name: "测试", command: "true", args: [], triggers };
}

describe("findActiveTrigger", () => {
  it("光标在 token 尾:命中 char 并给出 [charIndex, cursor) 区间", () => {
    const text = "解释 @src/main.ts";
    const hit = findActiveTrigger(text, text.length, [AT]);
    expect(hit?.spec).toBe(AT);
    expect(hit?.range).toEqual([3, text.length]);
  });

  it("同一 char 出现多次时取最靠近光标的那个", () => {
    const text = "@a @b";
    const hit = findActiveTrigger(text, text.length, [AT]);
    expect(hit?.range).toEqual([3, 5]);
  });

  it("char 之后遇到空格/换行则不属于活跃 token", () => {
    expect(findActiveTrigger("@a 后续", 5, [AT])).toBeNull();
    expect(findActiveTrigger("@a\n换行", 5, [AT])).toBeNull();
  });

  it("光标在 token 中间:按光标截断后仍能命中", () => {
    const text = "@abcdef";
    const hit = findActiveTrigger(text, 4, [AT]);
    expect(hit?.range).toEqual([0, 4]);
  });

  it("无匹配 char 返回 null;多 trigger 各自独立匹配", () => {
    expect(findActiveTrigger("纯文本", 3, [AT])).toBeNull();
    const hit = findActiveTrigger("/help", 5, [AT, SLASH]);
    expect(hit?.spec).toBe(SLASH);
  });
});

describe("findActiveTrigger(多字符触发符,composerExt 资产源)", () => {
  const BANG_BANG = { char: "!!" };
  const HASH_HASH = { char: "##" };

  it("双字符触发符:命中并给出双字符区间", () => {
    const text = "用 !!fix-bug";
    const hit = findActiveTrigger(text, text.length, [BANG_BANG]);
    expect(hit?.spec).toBe(BANG_BANG);
    expect(hit?.range).toEqual([2, text.length]);
  });

  it("单 ! 不构成 token(多字符 lastIndexOf 语义)", () => {
    expect(findActiveTrigger("强调 ! 一下", 6, [BANG_BANG])).toBeNull();
    expect(findActiveTrigger("!a !b", 5, [BANG_BANG])).toBeNull();
  });

  it("token 含空白即失效,与单字符语义一致", () => {
    expect(findActiveTrigger("!!a 后续", 5, [BANG_BANG])).toBeNull();
  });

  it("前置字符为词字符时不触发(词内 !! 不弹候选)", () => {
    expect(findActiveTrigger("foo!!bar", 8, [BANG_BANG])).toBeNull();
    expect(findActiveTrigger("中文!!bar", 7, [BANG_BANG])).not.toBeNull();
  });

  it("!! 与 ## 共存:各命中各的", () => {
    const hit = findActiveTrigger("##小张", 4, [BANG_BANG, HASH_HASH]);
    expect(hit?.spec).toBe(HASH_HASH);
    expect(hit?.range).toEqual([0, 4]);
  });
});

describe("translatePrompt", () => {
  it("所有 trigger 均无 translate 钩子 → 原文透传", () => {
    expect(translatePrompt(profileOf([SLASH, AT]), "/help @a.ts")).toBe("/help @a.ts");
  });

  it("有 translate 的 char:全量替换 token(保留触发符后的完整 token)", () => {
    expect(translatePrompt(profileOf([DOLLAR]), "用 $think 分析一下")).toBe(
      "用 /skill:think 分析一下",
    );
  });

  it("同一文本中多个 token 都被替换", () => {
    expect(translatePrompt(profileOf([DOLLAR]), "$a 和 $b")).toBe(
      "/skill:a 和 /skill:b",
    );
  });

  it("无 translate 的 trigger 不动,只翻有钩子的", () => {
    expect(translatePrompt(profileOf([DOLLAR, SLASH]), "$think /help")).toBe(
      "/skill:think /help",
    );
  });

  it("正则元字符触发符($)按字面匹配,不误伤普通文本", () => {
    expect(translatePrompt(profileOf([DOLLAR]), "价格是 100")).toBe("价格是 100");
  });

  it("边界收紧:$HOME/$PATH 等大写开头 shell 变量原样透传", () => {
    expect(translatePrompt(profileOf([DOLLAR]), "看 $HOME 和 $PATH")).toBe("看 $HOME 和 $PATH");
  });

  it("边界收紧:数字开头($100)与前导词字符(foo$bar)不触发翻译", () => {
    expect(translatePrompt(profileOf([DOLLAR]), "花了 $100")).toBe("花了 $100");
    expect(translatePrompt(profileOf([DOLLAR]), "foo$bar")).toBe("foo$bar");
  });

  it("词首大写 token($Think)不翻译 —— 漏译透传优于静默改写", () => {
    expect(translatePrompt(profileOf([DOLLAR]), "$Think")).toBe("$Think");
  });

  it("不含任何触发符的文本恒等透传(单向管线的往返不变量)", () => {
    const text = "一段没有任何 trigger 的普通 prompt";
    expect(translatePrompt(profileOf([DOLLAR, SLASH, AT]), text)).toBe(text);
  });
});

describe("prepareSendPayload", () => {
  it("无 translate profile:原文 + \\r(TUI 只认 CR 作 Enter)", () => {
    expect(prepareSendPayload(profileOf([SLASH]), "hello")).toBe("hello\r");
  });

  it("先 translate 再追加 \\r", () => {
    expect(prepareSendPayload(profileOf([DOLLAR]), "$think")).toBe("/skill:think\r");
  });

  it("bracketedPaste profile:正文包 ESC[200~…ESC[201~ 标记 + CR(translate 仍先生效)", () => {
    const profile: CliProfile = { ...profileOf([DOLLAR]), bracketedPaste: true };
    expect(prepareSendPayload(profile, "$think")).toBe(
      "\x1b[200~/skill:think\x1b[201~\r",
    );
  });

  it("bracketedPaste 未声明 = 裸文本注入(其余 TUI 无粘贴爆发启发式,不盲加转义)", () => {
    expect(prepareSendPayload(profileOf([SLASH]), "hello")).not.toContain("\x1b[200~");
  });

  it("发送变换链:translate 之后、CR 包装之前按注册序执行", () => {
    const transforms = [
      (text: string) => text + "\n\n块A",
      (text: string) => text + "\n\n块B",
    ];
    expect(prepareSendPayload(profileOf([SLASH]), "hello", transforms)).toBe(
      "hello\n\n块A\n\n块B\r",
    );
  });

  it("发送变换与 translate 同管线:$skill 先翻译再变换", () => {
    expect(prepareSendPayload(profileOf([DOLLAR]), "$think", [(t2) => t2 + "!"])).toBe(
      "/skill:think!\r",
    );
  });
});
