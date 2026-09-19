/**
 * structuredParsers 契约测试(shell / Dockerfile 结构化预览纯解析器):
 * - shell:shebang 仅识别文件首行;注释剥 # 入 notes;命令行保留原文;相邻注释归并;空行/尾注释切段;
 * - Dockerfile:行尾 \ 续行合并为一张指令卡;关键字大写 + 摘要取首行;注释成段;空行截断续行;
 * - 畸形输入回落:空文件、纯空白、仅注释产出空结构;CRLF 行尾不破坏分段、不残留 \r;
 *   续行丢失后的 && 开头行按首词当关键字兜底。
 */
import { describe, expect, it } from "vitest";
import { parseDockerfilePreview, parseShellPreview } from "./structuredParsers";

describe("parseShellPreview", () => {
  it("空文件与纯空白输入回落为空结构", () => {
    expect(parseShellPreview("")).toEqual({ shebang: "", sections: [] });
    expect(parseShellPreview("   \n\t\n \n")).toEqual({ shebang: "", sections: [] });
  });

  it("shebang 仅识别首行,后续 #! 行按注释段落处理", () => {
    const { shebang, sections } = parseShellPreview("#!/usr/bin/env bash\nrm -rf tmp\n#!/bin/sh");
    expect(shebang).toBe("#!/usr/bin/env bash");
    // 后续 #! 行:剥掉井号后落成 "!/bin/sh" 注释,且尾注释切段
    expect(sections).toEqual([
      { notes: [], commands: ["rm -rf tmp"] },
      { notes: ["!/bin/sh"], commands: [] },
    ]);
  });

  it("缩进过的首行 #! 不算 shebang,按注释处理", () => {
    const { shebang, sections } = parseShellPreview("  #!/bin/sh\ntrue");
    expect(shebang).toBe("");
    expect(sections).toEqual([{ notes: ["!/bin/sh"], commands: ["true"] }]);
  });

  it("无 shebang 的纯命令文件:shebang 为空,命令成段", () => {
    const { shebang, sections } = parseShellPreview("echo hi");
    expect(shebang).toBe("");
    expect(sections).toEqual([{ notes: [], commands: ["echo hi"] }]);
  });

  it("注释剥井号与单个空白,多井号同样剥;命令行保留原始缩进", () => {
    const { sections } = parseShellPreview("## 双井注释\n  indent=1");
    expect(sections).toEqual([{ notes: ["双井注释"], commands: ["  indent=1"] }]);
  });

  it("相邻注释归并进同一段;空行切段后命令独立成段", () => {
    const { sections } = parseShellPreview("# 步骤一\n# 补充\nls\n\ncd /tmp");
    expect(sections).toEqual([
      { notes: ["步骤一", "补充"], commands: ["ls"] },
      { notes: [], commands: ["cd /tmp"] },
    ]);
  });

  it("仅注释无命令:产出纯 notes 段", () => {
    expect(parseShellPreview("# 只读说明").sections).toEqual([{ notes: ["只读说明"], commands: [] }]);
  });

  it("CRLF 行尾:分段一致且内容不残留 \\r", () => {
    const { shebang, sections } = parseShellPreview("#!/bin/sh\r\n# 构建\r\nmake\r\n\r\n# 清理\r\nclean\r\n");
    expect(shebang).toBe("#!/bin/sh");
    expect(sections).toEqual([
      { notes: ["构建"], commands: ["make"] },
      { notes: ["清理"], commands: ["clean"] },
    ]);
  });
});

describe("parseDockerfilePreview", () => {
  it("空文件与纯空白输入回落为空数组", () => {
    expect(parseDockerfilePreview("")).toEqual([]);
    expect(parseDockerfilePreview(" \n\t\n")).toEqual([]);
  });

  it("无空格分隔的裸关键字指令:summary 为空、raw 原样", () => {
    expect(parseDockerfilePreview("FROM")).toEqual([
      { notes: [], instructions: [{ keyword: "FROM", summary: "", raw: "FROM" }] },
    ]);
  });

  it("小写关键字规范化为大写,摘要保留行内其余部分", () => {
    const sections = parseDockerfilePreview("from alpine:3.19");
    expect(sections[0]!.instructions[0]).toMatchObject({ keyword: "FROM", summary: "alpine:3.19" });
  });

  it("行中反斜杠不续行;只有行尾 \\ 触发合并;EOF 悬空续行收尾", () => {
    const sections = parseDockerfilePreview("RUN echo a\\b\nCOPY x \\\ny");
    const instructions = sections[0]!.instructions;
    expect(instructions).toHaveLength(2);
    expect(instructions[0]!.raw).toBe("RUN echo a\\b");
    expect(instructions[1]!.raw).toBe("COPY x \\\ny");
  });

  it("空行截断续行:前段成卡;续行丢失的 && 行按首词当关键字兜底", () => {
    const sections = parseDockerfilePreview("RUN apt-get update \\\n\n && rm -rf /var/lib/apt/lists/*");
    expect(sections[0]!.instructions[0]).toMatchObject({ keyword: "RUN", raw: "RUN apt-get update \\" });
    expect(sections[1]!.instructions[0]).toMatchObject({
      keyword: "&&",
      summary: "rm -rf /var/lib/apt/lists/*",
    });
  });

  it("注释在指令后出现则切段;段内相邻注释累积进同一 notes", () => {
    const sections = parseDockerfilePreview("FROM alpine\n# 安全补丁\n# 仅精简包\nRUN apk add git");
    expect(sections).toEqual([
      { notes: [], instructions: [{ keyword: "FROM", summary: "alpine", raw: "FROM alpine" }] },
      {
        notes: ["安全补丁", "仅精简包"],
        instructions: [{ keyword: "RUN", summary: "apk add git", raw: "RUN apk add git" }],
      },
    ]);
  });

  it("多物理行续行合并为一张卡;摘要只取首行;CRLF 同样处理", () => {
    const sections = parseDockerfilePreview(
      "RUN apt-get update \\\r\n && apt-get install -y git \\\r\n && rm -rf /var/lib/apt/lists/*\r\n",
    );
    expect(sections[0]!.instructions).toHaveLength(1);
    expect(sections[0]!.instructions[0]!.raw).toBe(
      "RUN apt-get update \\\n && apt-get install -y git \\\n && rm -rf /var/lib/apt/lists/*",
    );
    expect(sections[0]!.instructions[0]!.summary).toBe("apt-get update \\");
  });

  it("仅注释文件回落为纯 notes 段", () => {
    expect(parseDockerfilePreview("# 说明")).toEqual([{ notes: ["说明"], instructions: [] }]);
  });
});
