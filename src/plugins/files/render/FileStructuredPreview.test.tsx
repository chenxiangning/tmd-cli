/**
 * 结构化预览契约测试(node 环境 renderToStaticMarkup):
 * - shell:注释段归并、命令段收集、shebang 横幅;
 * - Dockerfile:续行合并成一张指令卡、关键字 pill + 摘要;
 * - 超预算回退 bounded 视图(只展示前 240 行)。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  FileStructuredPreview,
  parseDockerfilePreview,
  parseShellPreview,
} from "./FileStructuredPreview";

describe("parseShellPreview", () => {
  it("shebang 单列;注释块与命令块分段;空行分段", () => {
    const { shebang, sections } = parseShellPreview(
      ["#!/usr/bin/env bash", "# 安装依赖", "npm install", "", "# 清理", "rm -rf dist", "echo done"].join("\n"),
    );
    expect(shebang).toBe("#!/usr/bin/env bash");
    expect(sections).toEqual([
      { notes: ["安装依赖"], commands: ["npm install"] },
      { notes: ["清理"], commands: ["rm -rf dist", "echo done"] },
    ]);
  });

  it("尾随注释开启新段(不并入上一命令段)", () => {
    const { sections } = parseShellPreview("ls\n# 说明\ncd /tmp");
    expect(sections).toEqual([
      { notes: [], commands: ["ls"] },
      { notes: ["说明"], commands: ["cd /tmp"] },
    ]);
  });
});

describe("parseDockerfilePreview", () => {
  it("续行(\\)合并为一条指令;注释成段;关键字大写 + 摘要", () => {
    const sections = parseDockerfilePreview(
      [
        "# 基础镜像",
        "FROM node:22-alpine \\",
        "  AS builder",
        "",
        "RUN apk add --no-cache git",
      ].join("\n"),
    );
    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({ notes: ["基础镜像"] });
    expect(sections[0]!.instructions).toHaveLength(1);
    expect(sections[0]!.instructions[0]).toMatchObject({
      keyword: "FROM",
      /* codemoss 原行为:摘要取首行,续行反斜杠保留在摘要尾部 */
      summary: "node:22-alpine \\",
    });
    expect(sections[0]!.instructions[0]!.raw).toContain("\\\n  AS builder");
    expect(sections[1]!.instructions[0]!.keyword).toBe("RUN");
  });
});

describe("FileStructuredPreview 渲染", () => {
  function render(path: string, value: string): string {
    return renderToStaticMarkup(
      createElement(FileStructuredPreview, { filePath: path, value }),
    );
  }

  it("shell:渲染 shebang 横幅与命令标签", () => {
    const html = render("/x/deploy.sh", "#!/bin/sh\n# 部署\n./deploy.sh");
    expect(html).toContain("Shebang");
    expect(html).toContain("#!/bin/sh");
    expect(html).toContain("Commands");
    expect(html).toContain("./deploy.sh");
  });

  it("Dockerfile:渲染指令 pill", () => {
    const html = render("/app/Dockerfile", "FROM alpine:3\nRUN echo hi");
    expect(html).toContain("fvp-structured-preview-pill");
    expect(html).toContain("FROM");
    expect(html).toContain("alpine:3");
  });

  it("超预算回退:行数超 3000 只展示前 240 行并提示总数", () => {
    const lines = Array.from({ length: 3200 }, (_, i) => `echo line-${i}`);
    const html = render("/x/big.sh", lines.join("\n"));
    expect(html).toContain("240 / 3200");
    expect(html).toContain("line-239");
    expect(html).not.toContain("line-300");
  });
});
