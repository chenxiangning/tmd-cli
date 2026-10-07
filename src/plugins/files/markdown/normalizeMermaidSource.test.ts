/**
 * normalizeMermaidSource 契约测试 —— 照抄 codemoss 同名测试(核心用例)。
 * 覆盖:非 flowchart 不动、括号/<br/> 标签补引号、已引号/特殊形状不改写、
 * 嵌套双引号转义、安全标签不动。
 */
import { describe, expect, it } from "vitest";
import { normalizeMermaidSource } from "./normalizeMermaidSource";

describe("normalizeMermaidSource", () => {
  it("非 flowchart 图原样返回", () => {
    const sequence = "sequenceDiagram\nA->>B: hello (world)";
    expect(normalizeMermaidSource(sequence)).toBe(sequence);
  });

  it("含括号的长方形标签补引号", () => {
    const input = "flowchart TD\nA[text (parens)] --> B[ok]";
    expect(normalizeMermaidSource(input)).toBe(
      'flowchart TD\nA["text (parens)"] --> B[ok]',
    );
  });

  it("裸左 id 的目标标签补引号", () => {
    const input = "flowchart TD\nA --> B[check (requirePerm)]";
    expect(normalizeMermaidSource(input)).toBe(
      'flowchart TD\nA --> B["check (requirePerm)"]',
    );
  });

  it("<br/> 混括号标签补引号(LLM 常见产出)", () => {
    const input =
      "flowchart TD\nA[外部系统] --> B[从管理UI获取 Open API Key<br/>(JWT 运营登录, 设置: perms)]";
    expect(normalizeMermaidSource(input)).toBe(
      'flowchart TD\nA[外部系统] --> B["从管理UI获取 Open API Key<br/>(JWT 运营登录, 设置: perms)"]',
    );
  });

  it("含括号的菱形标签补引号", () => {
    const input = "flowchart TD\nG{操作类型 (x)} --> H[ok]";
    expect(normalizeMermaidSource(input)).toBe(
      'flowchart TD\nG{"操作类型 (x)"} --> H[ok]',
    );
  });

  it("已加引号的标签不改写", () => {
    const input = 'flowchart TD\nA["text (parens)"] --> B[ok]';
    expect(normalizeMermaidSource(input)).toBe(input);
  });

  it("cylinder/circle/stadium/subroutine 形状不改写", () => {
    const input = `flowchart TD
A[(Database)] --> B((Circle))
C([Stadium]) --> D[[Subroutine]]`;
    expect(normalizeMermaidSource(input)).toBe(input);
  });

  it("自动引号内嵌套双引号转义为 #quot;", () => {
    const input = 'flowchart TD\nA[say "hi" (now)] --> B[ok]';
    expect(normalizeMermaidSource(input)).toBe(
      'flowchart TD\nA["say #quot;hi#quot; (now)"] --> B[ok]',
    );
  });

  it("无特殊字符的安全标签不动", () => {
    const input = `flowchart TD
A[外部系统] --> B[后端校验]
B --> C[调用 /blade-system/open/v1/knowledge/**]`;
    expect(normalizeMermaidSource(input)).toBe(input);
  });

  it("支持 graph TD 头部", () => {
    const input = "graph TD\nA[x (y)] --> B[ok]";
    expect(normalizeMermaidSource(input)).toBe('graph TD\nA["x (y)"] --> B[ok]');
  });

  it("边标签含 {} 补引号(pty://out/{sessionId} 实证)", () => {
    const input = "flowchart LR\nB -->|pty://out/{sessionId} 原样字节| C[幕布]";
    expect(normalizeMermaidSource(input)).toBe(
      'flowchart LR\nB -->|"pty://out/{sessionId} 原样字节"| C[幕布]',
    );
  });

  it("边标签含 () 或 [] 同样补引号", () => {
    expect(normalizeMermaidSource("flowchart TD\nA -->|foo (bar)| B[x]")).toBe(
      'flowchart TD\nA -->|"foo (bar)"| B[x]',
    );
    expect(normalizeMermaidSource("flowchart TD\nA -->|a [b]| B[x]")).toBe(
      'flowchart TD\nA -->|"a [b]"| B[x]',
    );
  });

  it("已引号与无危险字符的边标签不动", () => {
    const quoted = 'flowchart TD\nA -->|"out/{id}"| B[x]';
    expect(normalizeMermaidSource(quoted)).toBe(quoted);
    const plain = "flowchart TD\nA -->|普通 文本 a<b>| B[x]";
    expect(normalizeMermaidSource(plain)).toBe(plain);
  });

  it("无闭合 | 或跨行标签原样放行", () => {
    const input = "flowchart TD\nA -- a | b --> B[x]";
    expect(normalizeMermaidSource(input)).toBe(input);
  });
});
