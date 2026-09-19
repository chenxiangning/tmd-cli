/**
 * fileTreeIcons 契约:
 * getFileTreeIconSvg —— 文件夹二态图标(闭合/展开,与名字无关,isOpen 仅作用于文件夹);
 * 文件图标按优先级链判别:git 前缀 → 锁文件模式(.lock/.lockb/-lock.) →
 * 扩展名品牌表 → eslint 前缀 → 精确文件名表(代码/文本) → 代码/文本扩展名集合 → 通用兜底;
 * 判别前统一小写化并剥离 `:line(-col)` 行号后缀;
 * 映射表静态不变量:EXT_ICONS 无重复键(对象字面量重复键会被静默覆盖)、表内引用的 icon_* 均有定义;
 * 家族网:同族文件图标逐字节一致、各族基准图标两两可判别且均为合法 SVG。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getFileTreeIconSvg } from "./fileTreeIcons";

const icon = (name: string, isFolder = false, isOpen = false): string =>
  getFileTreeIconSvg(name, isFolder, isOpen);

/* 家族网数据表:每个家族取首个成员为基准,其余成员必须与基准逐字节一致。 */
const exts = (list: string[]): string[] => list.map((e) => `f.${e}`);

const FAMILIES: Array<[string, string[]]> = [
  ["TS 徽章", exts(["ts", "tsx", "cts", "mts"])],
  ["JS 徽章", exts(["js", "jsx", "cjs", "mjs"])],
  ["JSON", exts(["json", "jsonc", "json5"])],
  ["Markdown", exts(["md", "markdown", "mdx"])],
  ["CSS 族", exts(["css", "scss", "sass", "less", "styl", "pcss", "postcss"])],
  ["HTML 族", exts(["html", "htm", "xml", "vue", "svelte", "astro"])],
  ["Shell", exts(["sh", "bash", "zsh", "fish", "bat", "cmd", "ps1"])],
  [
    "配置",
    exts(["yml", "yaml", "toml", "ini", "cfg", "conf", "properties", "editorconfig"]),
  ],
  ["图片", exts(["png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "svg", "avif"])],
  ["Nix", exts(["nix"])],
  [
    "代码通用",
    [
      ...exts([
        "py", "rs", "go", "java", "rb", "php", "c", "h", "cpp", "hpp", "cc",
        "cs", "swift", "kt", "scala", "sql", "graphql", "gql", "prisma",
        "proto", "lua", "zig", "ex", "exs", "erl", "hs", "ml", "clj", "dart",
        "r", "jl", "pl", "vim", "tf", "hcl", "gradle", "cmake", "nim", "d",
      ]),
      "makefile",
      "dockerfile",
      "jenkinsfile",
      "gemfile",
      "rakefile",
      "procfile",
      "pipfile",
      "gradlew",
    ],
  ],
  ["Git", [".git", ".gitignore", ".gitmodules", ".github"]],
  ["ESLint", [".eslintrc", ".eslintignore"]],
  [
    "锁文件",
    ["yarn.lock", "Cargo.lock", "bun.lockb", "flake.lock", "package-lock.json", "pnpm-lock.yaml"],
  ],
  [
    "文本通用",
    [
      ...exts(["txt", "log", "csv", "tsv", "rtf", "pdf", "doc", "docx", "tex", "adoc", "rst", "org", "epub"]),
      "readme",
      "license",
      "licence",
      "changelog",
    ],
  ],
  ["未知兜底", ["mystery.zzz", "noext", "file.", ".hidden"]],
];

describe("扩展名→图标家族网", () => {
  it("同族所有文件返回完全一致的图标,且图标是合法 SVG 字符串", () => {
    const bad: string[] = [];
    for (const [family, files] of FAMILIES) {
      const base = icon(files[0]);
      if (typeof base !== "string" || !base.startsWith("<svg")) {
        bad.push(`${family}: 基准 ${files[0]} 未得到 SVG 图标`);
        continue;
      }
      for (const f of files.slice(1)) {
        if (icon(f) !== base) bad.push(`${family}: ${f} 偏离基准 ${files[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("各族基准图标两两不同(族间可判别,网不失效),文件夹二态另成两族", () => {
    const probes: Array<[string, string]> = [
      ...FAMILIES.map(([family, files]) => [family, icon(files[0])] as [string, string]),
      ["文件夹(闭合)", icon("node_modules", true)],
      ["文件夹(展开)", icon("node_modules", true, true)],
    ];
    const clashes: string[] = [];
    for (let i = 0; i < probes.length; i++) {
      for (let j = i + 1; j < probes.length; j++) {
        if (probes[i][1] === probes[j][1]) clashes.push(`${probes[i][0]} == ${probes[j][0]}`);
      }
    }
    expect(clashes).toEqual([]);
  });
});

describe("映射表静态不变量(源码扫描)", () => {
  const source = readFileSync(new URL("./fileTreeIcons.ts", import.meta.url), "utf8");
  const start = source.indexOf("const EXT_ICONS");
  const body = start >= 0 ? source.slice(start, source.indexOf("\n};", start)) : "";

  it("EXT_ICONS 表体存在且无重复键", () => {
    expect(start).toBeGreaterThanOrEqual(0);
    const keys = [...body.matchAll(/^\s+(\w+): icon_/gm)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("表内引用的每个 icon_* 都有对应 const 定义(图标名存在)", () => {
    const refs = new Set([...body.matchAll(/icon_\w+/g)].map((m) => m[0]));
    expect(refs.size).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(new RegExp(`const ${ref}\\b`).test(source)).toBe(true);
    }
  });
});

describe("getFileTreeIconSvg 文件夹", () => {
  it("isOpen 缺省为闭合图标,展开态切换开口造型", () => {
    expect(icon("node_modules", true)).toBe(icon("node_modules", true, false));
    expect(icon("node_modules", true)).not.toBe(icon("node_modules", true, true));
  });

  it("文件夹图标与名字无关(带图片扩展名的目录仍是文件夹图标)", () => {
    expect(icon("assets", true)).toBe(icon("logo.png", true));
    expect(icon("assets", true)).not.toBe(icon("logo.png", false));
  });

  it("isOpen 对文件图标无影响", () => {
    expect(icon("a.ts", false, true)).toBe(icon("a.ts", false, false));
  });
});

describe("优先级链", () => {
  it("锁文件模式先于扩展名表:pnpm-lock.yaml 得锁图标而非配置图标", () => {
    expect(icon("pnpm-lock.yaml")).toBe(icon("yarn.lock"));
    expect(icon("package-lock.json")).toBe(icon("yarn.lock"));
  });

  it("扩展名表先于 eslint 前缀:eslint.config.js 得 JS 徽章", () => {
    expect(icon("eslint.config.js")).toBe(icon("a.js"));
  });

  it("无扩展名的 eslint 文件才走 eslint 图标", () => {
    expect(icon(".eslintrc")).toBe(icon(".eslintignore"));
    expect(icon(".eslintrc")).not.toBe(icon("mystery.zzz"));
  });

  it("文件名表要求全名精确匹配:Dockerfile 吃代码图标,Makefile.bak 落兜底", () => {
    expect(icon("Dockerfile")).toBe(icon("main.py"));
    expect(icon("Makefile.bak")).toBe(icon("mystery.zzz"));
  });
});

describe("行号后缀剥离", () => {
  it("纯数字 :line 与 :line-col 后缀剥离后按原扩展名取图标", () => {
    expect(icon("app.ts:42")).toBe(icon("app.ts"));
    expect(icon("app.ts:42-99")).toBe(icon("app.ts"));
  });

  it("剥离后可继续命中文件名表:readme:5 得文本图标", () => {
    expect(icon("readme:5")).toBe(icon("readme"));
  });

  it("非纯数字冒号后缀不剥离,整段尾段当扩展名落兜底", () => {
    expect(icon("app.ts:v2")).toBe(icon("mystery.zzz"));
  });
});

describe("大小写与点文件边界", () => {
  it("判别前统一小写化", () => {
    expect(icon("README.MD")).toBe(icon("a.md"));
    expect(icon("MAKEFILE")).toBe(icon("main.py"));
    expect(icon(".GitIgnore")).toBe(icon(".gitignore"));
  });

  it("git 前缀族:.git 本体与 .github 等前缀文件同族", () => {
    expect(icon(".git")).toBe(icon(".gitignore"));
    expect(icon(".github")).toBe(icon(".gitignore"));
  });

  it("无扩展名与空扩展名落兜底;多点文件取最后一段", () => {
    expect(icon("app.test.ts")).toBe(icon("a.ts"));
    expect(icon("app.min.js")).toBe(icon("a.js"));
    expect(icon("noext")).toBe(icon("mystery.zzz"));
    expect(icon("file.")).toBe(icon("mystery.zzz"));
  });
});
