/**
 * composer 扩展注册表契约测试:触发源与发送变换的注册序、反注册移除自身、
 * 重复反注册安全、唤醒桥默认未挂载。注册表是模块级单例,用例内注册、
 * afterEach 经返回的反注册函数全量清理。
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  composerSendTransforms,
  composerTriggerSources,
  composerWakeRef,
  registerComposerSendTransform,
  registerComposerTriggerSource,
  type ComposerSendTransform,
  type ComposerTriggerSource,
} from "./composerExt";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const un of cleanups.splice(0)) un();
});

const src = (char: string): ComposerTriggerSource => ({ char, label: char, list: () => [] });
const tf = (prefix: string): ComposerSendTransform => (text) => prefix + text;

describe("触发源注册表", () => {
  it("注册即合并进消费面,注册序保持", () => {
    cleanups.push(registerComposerTriggerSource(src("!!")));
    cleanups.push(registerComposerTriggerSource(src("##")));
    expect(composerTriggerSources().map((s) => s.char)).toEqual(["!!", "##"]);
  });

  it("反注册只移除自身,重复反注册安全", () => {
    const unFirst = registerComposerTriggerSource(src("!!"));
    const unSecond = registerComposerTriggerSource(src("##"));
    unFirst();
    unFirst();
    expect(composerTriggerSources().map((s) => s.char)).toEqual(["##"]);
    unSecond();
    expect(composerTriggerSources()).toEqual([]);
  });
});

describe("发送变换注册表", () => {
  it("按注册序执行,反注册后不再参与", () => {
    const unA = registerComposerSendTransform(tf("a"));
    const unB = registerComposerSendTransform((text) => text + "b");
    expect(composerSendTransforms().map((fn) => fn("x", null))).toEqual(["ax", "xb"]);
    unA();
    expect(composerSendTransforms().map((fn) => fn("x", null))).toEqual(["xb"]);
    unB();
    expect(composerSendTransforms()).toEqual([]);
  });
});

describe("唤醒桥", () => {
  it("默认未挂载(null),挂载后可交接", () => {
    expect(composerWakeRef.current).toBeNull();
    composerWakeRef.current = () => undefined;
    expect(typeof composerWakeRef.current).toBe("function");
    composerWakeRef.current = null;
  });
});
