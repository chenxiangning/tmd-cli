/**
 * DSH 适配器落盘契约测试(ensureAdapterDeployed)。
 * 覆盖:首次部署按序建三级目录、全量写 18 个 .cjs 清单 + .stamp(内容哈希
 * 版本戳)、返回入口绝对路径;版本戳命中 → 零扫描零写入直返(幂等);
 * 清场只删不在清单内的旧 .cjs、非 .cjs 与清单内文件不动、清理先于写入;
 * 同实例重复调用共享同一次部署(单例 Promise);目录创建失败被吞不阻塞。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { baseName } from "@kernel/pathUtils";
type AdapterDeployMod = typeof import("./adapterDeploy");

const mocks = vi.hoisted(() => ({
  configHomeDir: vi.fn(),
  fsCreateDir: vi.fn(),
  fsReadFile: vi.fn(),
  fsListDir: vi.fn(),
  fsWriteFile: vi.fn(),
  fsRemovePath: vi.fn(),
}));

vi.mock("@kernel/ipc", () => ({
  ipc: {
    configHomeDir: mocks.configHomeDir,
    fsCreateDir: mocks.fsCreateDir,
    fsReadFile: mocks.fsReadFile,
    fsListDir: mocks.fsListDir,
    fsWriteFile: mocks.fsWriteFile,
    fsRemovePath: mocks.fsRemovePath,
  },
}));

const HOME = "/Users/x";
const DIR = `${HOME}/.tmd-cli/adapters/dsh`;
const STAMP_PATH = `${DIR}/.stamp`;
const ENTRY = `${DIR}/dsh-adapter.cjs`;

/* adapterDeploy.FILES 清单(落盘面契约):重构增删适配器文件须同步此清单。 */
const MANIFEST = [
  "dsh-adapter.cjs",
  "dsh-rpc.cjs",
  "dsh-print.cjs",
  "dsh-project.cjs",
  "dsh-theme.cjs",
  "dsh-render.cjs",
  "dsh-commands.cjs",
  "dsh-menu.cjs",
  "dsh-menuhost.cjs",
  "dsh-keys.cjs",
  "dsh-click.cjs",
  "dsh-zone.cjs",
  "dsh-pending.cjs",
  "dsh-spinner.cjs",
  "dsh-footer.cjs",
  "dsh-stream.cjs",
  "dsh-turn.cjs",
  "dsh-think.cjs",
];

/* 被测模块持有模块级 ensured 单例 Promise,静态导入取不到全新部署水位,
   必须 resetModules + 动态 import 隔离用例。 */
let mod: AdapterDeployMod;

function firstDeploySetup() {
  mocks.configHomeDir.mockResolvedValue(HOME);
  mocks.fsCreateDir.mockResolvedValue(undefined);
  mocks.fsReadFile.mockRejectedValue(new Error("enoent"));
  mocks.fsListDir.mockResolvedValue([]);
  mocks.fsWriteFile.mockResolvedValue(undefined);
  mocks.fsRemovePath.mockResolvedValue(undefined);
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mod = await import("./adapterDeploy");
});

describe("ensureAdapterDeployed", () => {
  it("首次部署:按序建三级目录、全量写清单 + stamp、返回入口路径", async () => {
    firstDeploySetup();
    expect(await mod.ensureAdapterDeployed()).toBe(ENTRY);
    expect(mocks.fsCreateDir.mock.calls.map((c) => c[0])).toEqual([
      `${HOME}/.tmd-cli`,
      `${HOME}/.tmd-cli/adapters`,
      DIR,
    ]);
    const names = mocks.fsWriteFile.mock.calls.map((c) => baseName(c[0] as string));
    expect([...names].sort()).toEqual([...MANIFEST, ".stamp"].sort());
    for (const call of mocks.fsWriteFile.mock.calls) {
      if ((call[0] as string).endsWith(".cjs")) {
        expect(typeof call[1]).toBe("string");
        expect(call[1] as string, `${call[0]} 内容非空`).toBeTruthy();
      }
    }
  });

  it("版本戳命中:零扫描零写入直返入口(内容未变不重写)", async () => {
    firstDeploySetup();
    await mod.ensureAdapterDeployed();
    const stampCall = mocks.fsWriteFile.mock.calls.find((c) => c[0] === STAMP_PATH);
    const stamp = stampCall![1] as string;
    expect(stamp).toMatch(/^v1-/);

    /* 第二相位:全新模块实例 + 同内容戳 → 幂等直返。 */
    vi.clearAllMocks();
    mocks.fsReadFile.mockResolvedValue(stamp);
    mod = await import("./adapterDeploy");
    expect(await mod.ensureAdapterDeployed()).toBe(ENTRY);
    expect(mocks.fsListDir).not.toHaveBeenCalled();
    expect(mocks.fsWriteFile).not.toHaveBeenCalled();
    expect(mocks.fsRemovePath).not.toHaveBeenCalled();
  });

  it("清场:只删清单外旧 .cjs,非 .cjs 与清单内文件不动,清理先于写入", async () => {
    firstDeploySetup();
    mocks.fsListDir.mockResolvedValue([
      { name: "dsh-ghost.cjs" },
      { name: "notes.txt" },
      { name: "dsh-rpc.cjs" },
    ]);
    await mod.ensureAdapterDeployed();
    expect(mocks.fsRemovePath.mock.calls.map((c) => c[0])).toEqual([`${DIR}/dsh-ghost.cjs`]);
    const firstWrite = mocks.fsWriteFile.mock.invocationCallOrder[0];
    for (const order of mocks.fsRemovePath.mock.invocationCallOrder) {
      expect(order, "清场必须先于写入收口").toBeLessThan(firstWrite);
    }
  });

  it("同实例重复调用共享同一次部署(单例 Promise)", async () => {
    firstDeploySetup();
    const p1 = mod.ensureAdapterDeployed();
    const p2 = mod.ensureAdapterDeployed();
    expect(p2).toBe(p1);
    await Promise.all([p1, p2]);
    expect(mocks.fsListDir).toHaveBeenCalledTimes(1);
    expect(mocks.fsWriteFile).toHaveBeenCalledTimes(MANIFEST.length + 1);
  });

  it("目录创建失败被吞,部署照常完成", async () => {
    firstDeploySetup();
    mocks.fsCreateDir.mockRejectedValue(new Error("exists"));
    expect(await mod.ensureAdapterDeployed()).toBe(ENTRY);
    expect(mocks.fsWriteFile).toHaveBeenCalledTimes(MANIFEST.length + 1);
  });
});
