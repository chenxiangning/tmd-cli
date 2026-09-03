/**
 * 渲染档案分派契约测试 —— 移植 codemoss fileRenderProfile.test.ts 核心用例。
 * 覆盖:九种 kind 的扩展名/文件名分派、大小写归一、Dockerfile 变体、
 * shell rc 文件、优先级(image > pdf > tabular > document > binary > markdown > structured)。
 */

import { describe, expect, it } from "vitest";
import {
  fileExtensionFromPath,
  fileNameMatchKeyFromPath,
  isTabularBinaryPath,
  resolveFileRenderProfile,
  resolveStructuredPreviewKind,
} from "./renderProfile";

describe("路径工具", () => {
  it("反斜杠归一为 /,文件名小写", () => {
    expect(fileNameMatchKeyFromPath("C:\\Repo\\Docs\\ReadME.MD")).toBe("readme.md");
  });

  it("扩展名提取:无扩展/点结尾/纯点文件返回 null", () => {
    expect(fileExtensionFromPath("README")).toBeNull();
    expect(fileExtensionFromPath("README.")).toBeNull();
    expect(fileExtensionFromPath(".gitignore")).toBeNull();
    expect(fileExtensionFromPath("a.tar.GZ")).toBe("gz");
  });
});

describe("resolveFileRenderProfile 分派", () => {
  it("图片:全部 13 种扩展 → image", () => {
    const exts = ["png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "bmp", "heic", "heif", "tif", "tiff", "ico"];
    for (const ext of exts) {
      expect(resolveFileRenderProfile(`/x/logo.${ext}`).kind).toBe("image");
    }
  });

  it("PDF → pdf", () => {
    expect(resolveFileRenderProfile("/docs/report.PDF").kind).toBe("pdf");
  });

  it("表格:csv → tabular(文本);xls/xlsx → tabular(二进制)", () => {
    expect(resolveFileRenderProfile("/data/a.csv").kind).toBe("tabular");
    expect(isTabularBinaryPath("/data/a.csv")).toBe(false);
    expect(resolveFileRenderProfile("/data/a.XLSX").kind).toBe("tabular");
    expect(isTabularBinaryPath("/data/a.xlsx")).toBe(true);
  });

  it("文档:doc/docx → document", () => {
    expect(resolveFileRenderProfile("/docs/spec.docx").kind).toBe("document");
    expect(resolveFileRenderProfile("/docs/spec.doc").kind).toBe("document");
  });

  it("二进制:音视频/压缩包/字体/可执行 → binary-unsupported", () => {
    for (const ext of ["mp4", "mkv", "mp3", "zip", "7z", "ttf", "woff2", "exe", "dmg", "wasm", "pyc", "pptx"]) {
      expect(resolveFileRenderProfile(`/x/file.${ext}`).kind).toBe("binary-unsupported");
    }
  });

  it("markdown:md/mdx → markdown(markdown 扩展名由编辑器侧正则另行兼容)", () => {
    expect(resolveFileRenderProfile("/README.md").kind).toBe("markdown");
    expect(resolveFileRenderProfile("/README.mdx").kind).toBe("markdown");
  });

  it("结构化:sh 族扩展与 rc 文件 → structured/shell", () => {
    for (const ext of ["sh", "bash", "zsh", "ksh", "dash", "command"]) {
      expect(resolveStructuredPreviewKind(`/bin/deploy.${ext}`)).toBe("shell");
    }
    for (const name of [".envrc", ".bashrc", ".zshrc", ".profile"]) {
      expect(resolveStructuredPreviewKind(`/home/${name}`)).toBe("shell");
    }
    expect(resolveFileRenderProfile("/bin/deploy.sh").kind).toBe("structured");
  });

  it("结构化:Dockerfile 及变体 → structured/dockerfile", () => {
    expect(resolveStructuredPreviewKind("Dockerfile")).toBe("dockerfile");
    expect(resolveStructuredPreviewKind("dockerfile.dev")).toBe("dockerfile");
    expect(resolveStructuredPreviewKind("Dockerfile.prod")).toBe("dockerfile");
    expect(resolveStructuredPreviewKind("my-dockerfile")).toBeNull();
  });

  it("其余一切 → code", () => {
    expect(resolveFileRenderProfile("/src/main.ts").kind).toBe("code");
    expect(resolveFileRenderProfile("/src/index.jsx").kind).toBe("code");
    expect(resolveFileRenderProfile("/无扩展").kind).toBe("code");
    expect(resolveFileRenderProfile("/无扩展").extension).toBeNull();
  });

  it("profile 字段完整性", () => {
    const profile = resolveFileRenderProfile("/app/Dockerfile");
    expect(profile).toMatchObject({
      kind: "structured",
      previewMode: "structured-preview",
      extension: null,
      structuredKind: "dockerfile",
    });
    expect(profile.normalizedLookupPath).toBe("/app/Dockerfile");
  });
});
