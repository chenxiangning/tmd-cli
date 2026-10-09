/** isMissingFileError 平台文案回归:Windows 缺失文案曾三模式全不命中 →
 *  新建画布保存/索引首读在 Windows 全断(0.3.5 评审 P1)。os error 2 双平台
 *  语义恒为 ENOENT/ERROR_FILE_NOT_FOUND,作 Rust 哨兵前的结构化兜底。 */
import { describe, expect, it } from "vitest";
import { isMissingFileError } from "../storage/paths";

describe("isMissingFileError", () => {
  it("识别 macOS/Linux NotFound 文案", () => {
    expect(isMissingFileError(new Error("读取文件信息失败: No such file or directory (os error 2)"))).toBe(true);
  });
  it("识别 Windows EN/zh 缺失文案(曾经全漏)", () => {
    expect(isMissingFileError(new Error("读取文件信息失败: The system cannot find the file specified. (os error 2)"))).toBe(true);
    expect(isMissingFileError(new Error("读取文件信息失败: 系统找不到指定的文件。 (os error 2)"))).toBe(true);
  });
  it("非缺失错误不误判(权限/超限/未知)", () => {
    expect(isMissingFileError(new Error("读取文件信息失败: Access is denied. (os error 5)"))).toBe(false);
    expect(isMissingFileError(new Error("文件超过 512KB,暂不支持预览"))).toBe(false);
    expect(isMissingFileError(new Error("boom"))).toBe(false);
  });
});
