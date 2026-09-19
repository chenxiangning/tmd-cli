/**
 * CodeMirror 语言映射测试 —— cmLanguage 契约清单:
 * 1. 一张网:switch 注册的全部扩展名逐一加载,结果非空(所有导入路径真实可达)
 * 2. 扩展名大小写归一:"a.TS" 与 "a.ts" 命中同一缓存项(Promise 同一引用)
 * 3. 同扩展名重复加载复用同一 Promise(模块级缓存)
 * 4. 多段点路径取末段("vite.config.ts" → ts)
 * 5. 无扩展名路径(含末段为空)与未知扩展名回落纯文本([])
 * 6. 语言包加载失败降级 [],且失败结果入缓存不再重试
 */
import { describe, expect, it, vi } from "vitest";

import { loadCmLanguage } from "./cmLanguage";

type LoadCmLanguage = typeof loadCmLanguage;

/* 与 cmLanguage.ts switch 分支一一对应;新增分支须同步补入本网。 */
const REGISTERED_EXTS = [
  "ts", "mts", "cts", "tsx", "js", "mjs", "cjs", "jsx", //
  "json", "html", "htm", "vue", "svelte", "css", "scss", "less",
  "md", "markdown", "mdx", "py", "rs", "c", "h", "cc",
  "cpp", "cxx", "hpp", "hh", "hxx", "go", "java", "php",
  "sql", "rb", "ruby", "gemfile", "sh", "bash", "zsh", "fish",
  "swift", "toml", "r", "xml", "svg", "yml", "yaml",
];

describe("注册语言映射一张网", () => {
  it("每个注册扩展名加载结果非空(导入路径全部真实可达)", async () => {
    for (const ext of REGISTERED_EXTS) {
      const extensions = await loadCmLanguage(`x.${ext}`);
      expect(extensions.length, `扩展 .${ext} 应映射到非空语言扩展`).toBeGreaterThan(0);
    }
  });
});

describe("缓存与路径归一", () => {
  it("扩展名大小写归一:大写扩展命中同一缓存项", async () => {
    const lower = loadCmLanguage("a.ts");
    expect((await lower).length).toBeGreaterThan(0);
    expect(loadCmLanguage("b.TS")).toBe(lower);
  });

  it("同扩展名重复加载复用同一 Promise", () => {
    const first = loadCmLanguage("m.py");
    expect(loadCmLanguage("m.py")).toBe(first);
  });

  it("多段点路径取末段扩展名", async () => {
    const extensions = await loadCmLanguage("vite.config.ts");
    expect(extensions.length).toBeGreaterThan(0);
  });
});

describe("未知回落", () => {
  it("无扩展名路径与末段为空回落纯文本", async () => {
    await expect(loadCmLanguage("Dockerfile")).resolves.toEqual([]);
    await expect(loadCmLanguage("x.")).resolves.toEqual([]);
    await expect(loadCmLanguage("")).resolves.toEqual([]);
  });

  it("未知扩展名回落纯文本", async () => {
    await expect(loadCmLanguage("x.zzzunknown")).resolves.toEqual([]);
  });

  /* 故意动态 import:测模块缓存清空后重新实例化的加载边界,静态 import 拿不到新实例。 */
  it("语言包加载失败降级 [],失败结果入缓存不再重试", async () => {
    vi.resetModules();
    vi.doMock("@codemirror/lang-python", () => {
      throw new Error("boom");
    });
    try {
      const fresh = (await import("./cmLanguage")) as { loadCmLanguage: LoadCmLanguage };
      const first = fresh.loadCmLanguage("m.py");
      await expect(first).resolves.toEqual([]);
      expect(fresh.loadCmLanguage("m.py")).toBe(first);
    } finally {
      vi.doUnmock("@codemirror/lang-python");
      vi.resetModules();
    }
  });
});
