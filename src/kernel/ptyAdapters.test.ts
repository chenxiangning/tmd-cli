/**
 * ptyAdapters 契约:
 * registerSpecWrapper / applySpecWrappers —— 包装按注册顺序串联,后者收前者的输出;
 * 无注册者时 spec 原样返回(同一引用);退订后不再参与串联;异步包装被 await;
 * registerShellSpecProvider / findShellSpecProvider —— 首个 appliesTo 命中者接管,
 * 全不命中 = null;退订即摘除;命中判定只认 appliesTo,与注册顺序无关(先注册先接管)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SpawnSpec } from "./ipc";
import type { Workspace } from "./workspace";

/* 动态 import 例外:wrappers/shellProviders 是模块级单例数组,静态 import 会跨
   用例共享注册表;必须 resetModules 后取全新实例(范式同 terminalLinks.test.ts) */
import type { ShellSpecProvider } from "./ptyAdapters";
let mod: typeof import("./ptyAdapters");

beforeEach(async () => {
  vi.resetModules();
  mod = await import("./ptyAdapters");
});

function ws(id: string): Workspace {
  return { id, name: id, root: `/tmp/${id}`, createdAt: 0 };
}

const spec = (command: string): SpawnSpec => ({ command, args: [], cwd: "/tmp" });

describe("registerSpecWrapper / applySpecWrappers", () => {
  it("无注册者时原样返回同一引用", async () => {
    const s = spec("sh");
    await expect(mod.applySpecWrappers(s)).resolves.toBe(s);
  });

  it("多个包装按注册顺序串联,后者收到前者输出", async () => {
    const order: string[] = [];
    mod.registerSpecWrapper(async (s: SpawnSpec) => {
      order.push("w1");
      return { ...s, command: `${s.command}:w1` };
    });
    mod.registerSpecWrapper(async (s: SpawnSpec) => {
      order.push("w2");
      return { ...s, args: [s.command] };
    });
    const out = await mod.applySpecWrappers(spec("base"));
    expect(order).toEqual(["w1", "w2"]);
    expect(out.command).toBe("base:w1");
    expect(out.args).toEqual(["base:w1"]);
  });

  it("退订的包装不再参与串联;退订其余包装不受影响", async () => {
    const unwrapped = mod.registerSpecWrapper(async (s: SpawnSpec) => ({ ...s, command: "bad" }));
    unwrapped();
    const keep = mod.registerSpecWrapper(async (s: SpawnSpec) => ({ ...s, command: "good" }));
    mod.registerSpecWrapper(async (s: SpawnSpec) => ({ ...s, args: [s.command] }));
    const out = await mod.applySpecWrappers(spec("x"));
    expect(out.command).toBe("good");
    expect(out.args).toEqual(["good"]);
    keep();
    /* 只剩第三个包装:command 原样保留,args 镜像 command —— 退订不牵连在册包装 */
    const out2 = await mod.applySpecWrappers(spec("y"));
    expect(out2.command).toBe("y");
    expect(out2.args).toEqual(["y"]);
  });

  it("返回 Promise 的包装被 await 后,下游拿到已决值而非 Promise", async () => {
    let seen = false;
    mod.registerSpecWrapper(async (s: SpawnSpec) => ({ ...s, command: "resolved" }));
    mod.registerSpecWrapper(async (s: SpawnSpec) => {
      /* 若上游未被 await,这里收到的 command 会是 Promise 对象 */
      expect(s.command).toBe("resolved");
      seen = true;
      return s;
    });
    const out = await mod.applySpecWrappers(spec("z"));
    expect(seen).toBe(true);
    expect(out.command).toBe("resolved");
  });
});

describe("registerShellSpecProvider / findShellSpecProvider", () => {
  it("全不命中返回 null;命中返回首个注册的提供者", () => {
    expect(mod.findShellSpecProvider(ws("local"))).toBeNull();
    const p1: ShellSpecProvider = { appliesTo: (w) => w.id === "wsl1", build: async () => spec("a") };
    const p2: ShellSpecProvider = { appliesTo: () => true, build: async () => spec("b") };
    mod.registerShellSpecProvider(p1);
    mod.registerShellSpecProvider(p2);
    expect(mod.findShellSpecProvider(ws("wsl1"))).toBe(p1);
    expect(mod.findShellSpecProvider(ws("other"))).toBe(p2);
  });

  it("退订后不再命中;退订首个命中者后由后续接管", () => {
    const p1: ShellSpecProvider = { appliesTo: () => true, build: async () => spec("a") };
    const unsub1 = mod.registerShellSpecProvider(p1);
    unsub1();
    expect(mod.findShellSpecProvider(ws("any"))).toBeNull();
    const p2: ShellSpecProvider = { appliesTo: () => true, build: async () => spec("b") };
    mod.registerShellSpecProvider(p1);
    mod.registerShellSpecProvider(p2);
    const unsub2 = mod.registerShellSpecProvider(p1);
    unsub2();
    expect(mod.findShellSpecProvider(ws("any"))).toBe(p2);
  });

  it("build 的展示语义由提供者自决,kernel 不注入额外字段", async () => {
    const built = spec("bash");
    built.title = "bash";
    const p: ShellSpecProvider = { appliesTo: () => true, build: async () => built };
    mod.registerShellSpecProvider(p);
    const found = mod.findShellSpecProvider(ws("w"));
    await expect(found?.build(ws("w"))).resolves.toBe(built);
  });
});
