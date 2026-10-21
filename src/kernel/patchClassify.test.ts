/** patch 行分类单测:头/元信息先行于 +/-,no-newline 标记归 meta。 */
import { describe, expect, it } from "vitest";
import { classifyPatchLine } from "./patchClassify";

describe("classifyPatchLine", () => {
  it("add/del/ctx/hunk 基本判定", () => {
    expect(classifyPatchLine("+added")).toBe("add");
    expect(classifyPatchLine("-removed")).toBe("del");
    expect(classifyPatchLine(" unchanged")).toBe("ctx");
    expect(classifyPatchLine("@@ -1,3 +1,4 @@")).toBe("hunk");
  });

  it("头部与元信息归 meta,不误判 del/ctx", () => {
    expect(classifyPatchLine("--- a/src/x.ts")).toBe("meta");
    expect(classifyPatchLine("+++ b/src/x.ts")).toBe("meta");
    expect(classifyPatchLine("diff --git a/x b/x")).toBe("meta");
    expect(classifyPatchLine("index 3f2b8c1..9def112 100644")).toBe("meta");
    expect(classifyPatchLine("new file mode 100644")).toBe("meta");
    expect(classifyPatchLine("deleted file mode 100644")).toBe("meta");
    expect(classifyPatchLine("rename from a/x.ts")).toBe("meta");
    expect(classifyPatchLine("Binary files a/x and b/x differ")).toBe("meta");
    expect(classifyPatchLine("GIT binary patch")).toBe("meta");
    expect(classifyPatchLine("\\ No newline at end of file")).toBe("meta");
  });

  it("空串与普通行归 ctx", () => {
    expect(classifyPatchLine("")).toBe("ctx");
    expect(classifyPatchLine("plain")).toBe("ctx");
  });
});
