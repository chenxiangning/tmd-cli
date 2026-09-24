/**
 * selfhostDeployModel.deriveStepStates 状态机:
 *   未提交全 pending;已提交无事件 = connect 转圈;收到 step ok 事件后该步 ok
 *   且下一步 running;失败步 failed 且后续步 pending(重放幂等);
 *   result.ok=true 全 ok;result.ok=false 以 result.steps 为准(杂散 id 忽略)。
 * 手法:纯函数直测,无 DOM(i18n 未消费;t() 不在本模块)。
 */
import { expect, it } from "vitest";
import type { RelayDeployProgress, SelfhostDeployResult } from "@kernel/ipc";
import { deriveStepStates, SELFHOST_STEPS } from "./selfhostDeployModel";

const ev = (step: string, ok: boolean): RelayDeployProgress => ({ step, ok });

const res = (
  extra: Partial<SelfhostDeployResult> = {},
): SelfhostDeployResult => ({
  ok: false,
  url: "",
  key: "",
  fingerprint: "",
  steps: [],
  ...extra,
});

it("未提交:全 pending(即使攒了历史事件也不点亮)", () => {
  const s = deriveStepStates(false, [ev("connect", true)], null);
  for (const id of SELFHOST_STEPS) expect(s[id]).toBe("pending");
});

it("已提交无事件:connect running,其余 pending", () => {
  const s = deriveStepStates(true, [], null);
  expect(s.connect).toBe("running");
  for (const id of SELFHOST_STEPS.slice(1)) expect(s[id]).toBe("pending");
});

it("进度事件流:step ok 后该步 ok、下一步 running;末步 ok 后无 running", () => {
  let s = deriveStepStates(true, [ev("connect", true)], null);
  expect(s.connect).toBe("ok");
  expect(s.cert).toBe("running");
  expect(s.upload).toBe("pending");
  s = deriveStepStates(
    true,
    SELFHOST_STEPS.slice(0, 4).map((id) => ev(id, true)),
    null,
  );
  expect(s.health).toBe("running");
  s = deriveStepStates(
    true,
    SELFHOST_STEPS.map((id) => ev(id, true)),
    null,
  );
  for (const id of SELFHOST_STEPS) expect(s[id]).toBe("ok");
});

it("失败步 failed 且后续 pending(事件流与 result.steps 两态一致)", () => {
  let s = deriveStepStates(
    true,
    [ev("connect", true), ev("cert", true), ev("upload", false)],
    null,
  );
  expect(s.connect).toBe("ok");
  expect(s.cert).toBe("ok");
  expect(s.upload).toBe("failed");
  expect(s.systemd).toBe("pending");
  /* result 落定(失败):以 steps 为准,后续步即便被记 ok=false 也归 pending。 */
  s = deriveStepStates(true, [], res({
    steps: [
      { id: "connect", ok: true },
      { id: "cert", ok: false, error: "铸证失败" },
      { id: "upload", ok: false },
      { id: "systemd", ok: false },
      { id: "health", ok: false },
    ],
  }));
  expect(s.connect).toBe("ok");
  expect(s.cert).toBe("failed");
  for (const id of ["upload", "systemd", "health"] as const)
    expect(s[id]).toBe("pending");
});

it("result.ok=true:全 ok(盖过事件流)", () => {
  const s = deriveStepStates(true, [ev("connect", false)], res({ ok: true }));
  for (const id of SELFHOST_STEPS) expect(s[id]).toBe("ok");
});

it("杂散 step id 不进 checklist(事件流与 result.steps 都过滤)", () => {
  let s = deriveStepStates(true, [ev("connect", true), ev("bogus", false)], null);
  expect(s.cert).toBe("running");
  s = deriveStepStates(
    true,
    [],
    res({ steps: [{ id: "connect", ok: true }, { id: "bogus", ok: false }] }),
  );
  expect(s.connect).toBe("ok");
  expect(s.cert).toBe("pending");
});
