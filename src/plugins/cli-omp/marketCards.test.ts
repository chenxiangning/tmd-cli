import { describe, expect, it, vi } from "vitest";

/* installId 所在模块 import 链带 ipc/@phosphor-icons-react/react;本用例只验纯函数,给空桩。 */
vi.mock("@kernel/ipc", () => ({
  ipc: {},
  onCliInstallEvent: vi.fn(),
  openExternalUrl: vi.fn(),
}));

import { installId } from "./marketInstallModel";

describe("installId(装卸事件流 id)", () => {
  it("scoped 包名产出的 id 只含 Tauri 事件名合法字符(字母数字与 - _)", () => {
    /* `@` 违禁:Tauri 仅允许字母数字与 - / : _,emit 静默失败导致按钮永转。 */
    const id = installId("@juicesharp/rpiv-todo");
    expect(id).toMatch(/^omp-ext-[a-f0-9]+$/);
    expect(id).not.toContain("@");
  });

  it("一一对应:不同包名不撞 id(部分转义有歧义,整体 hex 无)", () => {
    /* "a/b" 若只转义 `/` 会与字面量 "a2fb" 相撞;全 hex 编码保证单射。 */
    const ids = ["a/b", "a2fb", "pi-todo", "@scope/pkg"].map(installId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
