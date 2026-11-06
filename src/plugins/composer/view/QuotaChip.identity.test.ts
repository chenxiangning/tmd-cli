/** QuotaChip 身份解析契约(2026-11-06 回归钉,实证截图 + 4d4cd116 引入):
 *  composer 裸挂 <QuotaChip /> 时 React 恒传 {},原 `source ?` 真值判空被空
 *  对象骗过 —— chip 恒拿 null 模型,omp 路由报「未识别当前模型,无法路由
 *  供应商」(额度弹窗悬空报错,pill 却显示模型串)。契约:空覆写 = 活跃
 *  会话推导;显式覆写(ssToolbar)字段直通。 */
import { describe, expect, it } from "vitest";
import { resolveQuotaIdentity } from "./quotaIdentity";

const SESSION = { engine: "omp", profileId: "omp", cwd: "/repo" };
const OMP_MODEL = "zhipu-coding-plan/glm-5.3";

describe("resolveQuotaIdentity(空对象覆写不遮会话推导)", () => {
  it("composer 裸挂(React 传 {}):回退活跃会话——模型/身份/cwd 全量回填", () => {
    const id = resolveQuotaIdentity({}, "pty-1", SESSION, OMP_MODEL, "omp-uuid-1");
    expect(id).toEqual({
      profileId: "omp",
      model: OMP_MODEL, /* 回归点:旧实现此处为 null → omp 报未识别 */
      cwd: "/repo",
      cliSessionId: "omp-uuid-1",
    });
  });

  it("活跃会话无 status.model:模型 null(路由层显式报未识别,不猜)", () => {
    const id = resolveQuotaIdentity({}, "pty-1", SESSION, undefined, undefined);
    expect(id.model).toBeNull();
    expect(id.profileId).toBe("omp");
  });

  it("无活跃会话:模型 null 且不带 cwd/cliSessionId", () => {
    const id = resolveQuotaIdentity({}, undefined, undefined, OMP_MODEL, "omp-uuid-1");
    expect(id).toEqual({ profileId: undefined, model: null, cwd: undefined, cliSessionId: undefined });
  });

  it("ssToolbar 显式覆写:字段直通,不被会话推导污染", () => {
    const id = resolveQuotaIdentity(
      { profileId: "pi", model: "kimi-code/k3", cwd: "/rpc-cwd", cliSessionId: "rpc-1" },
      "pty-1",
      SESSION,
      OMP_MODEL,
      "omp-uuid-1",
    );
    expect(id).toEqual({ profileId: "pi", model: "kimi-code/k3", cwd: "/rpc-cwd", cliSessionId: "rpc-1" });
  });

  it("覆写只给部分字段:缺省字段仍回退会话推导", () => {
    const id = resolveQuotaIdentity({ profileId: "omp" }, "pty-1", SESSION, OMP_MODEL, "omp-uuid-1");
    expect(id.model).toBe(OMP_MODEL);
    expect(id.cwd).toBe("/repo");
  });
});
