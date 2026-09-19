/**
 * cli-shared 命令/技能磁盘发现契约测试(主文件 mdCommands,并入 qoderSuggestions)。
 * 覆盖契约:
 * - scanCommandMdDirs:递归 .md 派生冒号命名空间;description 取 frontmatter、缺省回落正文首行;
 *   散装 .md 允许 frontmatter name 覆盖派生名,SKILL.md 命令目录恒以目录名为命令名(frontmatter 不改写);
 *   SKILL.md 目录整目录吸收:目录内散装 .md 忽略、根级裸 SKILL.md 无命令语义;
 *   同名命令先到先得(调用方目录顺序 = 覆盖优先级);目录读失败跳过、文件读失败无描述;
 *   单目录扫描上限 2000 透传给 walk。
 * - listQoderSuggestions:kind 分流(command 两个目录面 / skill 四个含 .agents 兼容层);
 *   configHomeDir 失败回空不抛错;cwd 为键 TTL 缓存(命中不再走盘、并发共享一次查询、kind 互不串池)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ipcMock = vi.hoisted(() => ({
  fsWalkFiles: vi.fn(),
  fsReadFile: vi.fn(),
  fsReadTail: vi.fn(),
  configHomeDir: vi.fn(),
}));

vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));

type MdCommandsModule = typeof import("./mdCommands");
type QoderSuggestionsModule = typeof import("./qoderSuggestions");

let md: MdCommandsModule;
let qoder: QoderSuggestionsModule;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  // 动态 import 例外:qoderSuggestions 持模块级 TTL 缓存单例,须取全新实例
  md = await import("./mdCommands");
  qoder = await import("./qoderSuggestions");
});

/** 目录 walk 桩:按根路径给定条目,未声明根回空(目录语义)。 */
function walkResult(entries: Record<string, string[]>) {
  ipcMock.fsWalkFiles.mockImplementation((root: string) => Promise.resolve(entries[root] ?? []));
}

/** 文件读桩:未声明的路径按读失败拒绝(防 fixture 漏写静默成无描述)。 */
function readResult(files: Record<string, string>) {
  ipcMock.fsReadFile.mockImplementation((path: string) =>
    path in files ? Promise.resolve(files[path]) : Promise.reject(new Error(`fixture 未声明: ${path}`)),
  );
}

describe("scanCommandMdDirs", () => {
  it("递归 .md 派生冒号命名空间;description 取 frontmatter,缺省回落正文首行", async () => {
    walkResult({ "/proj/.claude/commands": ["deploy.md", "git/commit.md"] });
    readResult({
      "/proj/.claude/commands/deploy.md": "---\ndescription: 一键部署\n---\n正文",
      "/proj/.claude/commands/git/commit.md": "先写提交说明\n第二步",
    });
    expect(await md.scanCommandMdDirs(["/proj/.claude/commands"])).toEqual([
      { value: "deploy", description: "一键部署", action: "insert", icon: "slash" },
      { value: "git:commit", description: "先写提交说明", action: "insert", icon: "slash" },
    ]);
  });

  it("散装 .md 的 frontmatter name 覆盖派生名;SKILL.md 命令目录不受 frontmatter name 改写", async () => {
    walkResult({ "/h/.claude/commands": ["open-spec/new.md", "git/SKILL.md"] });
    readResult({
      "/h/.claude/commands/open-spec/new.md": "---\nname: os-new\ndescription: 新建规格\n---\n",
      "/h/.claude/commands/git/SKILL.md": "---\nname: 必须被忽略\ndescription: git 套件\n---\n",
    });
    const out = await md.scanCommandMdDirs(["/h/.claude/commands"]);
    expect(out.map((s) => s.value)).toEqual(["os-new", "git"]);
    expect(out[1]?.description).toBe("git 套件");
  });

  it("SKILL.md 目录整目录吸收:目录内散装 .md 忽略;根级裸 SKILL.md 无命令语义", async () => {
    walkResult({
      "/h/.qoder/commands": ["git/SKILL.md", "git/legacy.md", "SKILL.md", "solo.md"],
    });
    readResult({ "/h/.qoder/commands/git/SKILL.md": "", "/h/.qoder/commands/solo.md": "单独命令" });
    const out = await md.scanCommandMdDirs(["/h/.qoder/commands"]);
    /* 调用名 = 目录名(qoder 实证 /git),与源码头注释契约一致 */
    expect(out.map((s) => s.value)).toEqual(["git", "solo"]);
    expect(out[0]?.description).toBeUndefined();
  });

  it("同名命令先到先得:前一目录胜出,后目录同值不再注册", async () => {
    walkResult({ "/a": ["deploy.md"], "/b": ["deploy.md", "extra.md"] });
    readResult({ "/a/deploy.md": "A 版部署", "/b/deploy.md": "B 版部署", "/b/extra.md": "补充" });
    const out = await md.scanCommandMdDirs(["/a", "/b"]);
    expect(out.map((s) => s.value)).toEqual(["deploy", "extra"]);
    expect(out[0]?.description).toBe("A 版部署");
  });

  it("目录读失败该目录整体跳过;文件读失败命令仍在但无描述", async () => {
    ipcMock.fsWalkFiles.mockImplementation((root: string) =>
      root === "/坏" ? Promise.reject(new Error("ENOENT")) : Promise.resolve(["x.md", "y.md"]),
    );
    ipcMock.fsReadFile.mockImplementation((path: string) =>
      path === "/好/x.md" ? Promise.reject(new Error("EIO")) : Promise.resolve("y 正文"),
    );
    expect(await md.scanCommandMdDirs(["/坏", "/好"])).toEqual([
      { value: "x", description: undefined, action: "insert", icon: "slash" },
      { value: "y", description: "y 正文", action: "insert", icon: "slash" },
    ]);
  });

  it("单目录扫描上限 2000 透传给 walk(防误传仓库根的设闸)", async () => {
    walkResult({ "/d": [] });
    await md.scanCommandMdDirs(["/d"]);
    expect(ipcMock.fsWalkFiles).toHaveBeenCalledWith("/d", 2000);
  });
});

describe("listQoderSuggestions", () => {
  it("kind 分流:command 扫两处 .qoder/commands,skill 扫四处(含 .agents 兼容层)", async () => {
    ipcMock.configHomeDir.mockResolvedValue("/home");
    walkResult({});
    await qoder.listQoderSuggestions("command", "/repo");
    expect(ipcMock.fsWalkFiles).toHaveBeenCalledTimes(2);
    expect(ipcMock.fsWalkFiles).toHaveBeenCalledWith("/repo/.qoder/commands", 2000);
    expect(ipcMock.fsWalkFiles).toHaveBeenCalledWith("/home/.qoder/commands", 2000);

    await qoder.listQoderSuggestions("skill", "/repo");
    expect(ipcMock.fsWalkFiles.mock.calls.slice(2).map((c) => c[0])).toEqual([
      "/repo/.qoder/skills",
      "/home/.qoder/skills",
      "/repo/.agents/skills",
      "/home/.agents/skills",
    ]);
  });

  it("configHomeDir 失败回空建议,不抛错也不发起扫描", async () => {
    ipcMock.configHomeDir.mockRejectedValue(new Error("未就绪"));
    await expect(qoder.listQoderSuggestions("command", "/repo")).resolves.toEqual([]);
    await expect(qoder.listQoderSuggestions("skill", "/repo")).resolves.toEqual([]);
    expect(ipcMock.fsWalkFiles).not.toHaveBeenCalled();
  });

  it("cwd 为键 TTL 缓存:同 cwd 并发共享一次查询,不同 cwd 各自查盘", async () => {
    ipcMock.configHomeDir.mockResolvedValue("/home");
    walkResult({ "/repo/.qoder/commands": ["deploy.md"] });
    readResult({ "/repo/.qoder/commands/deploy.md": "部署" });
    const [a, b] = await Promise.all([
      qoder.listQoderSuggestions("command", "/repo"),
      qoder.listQoderSuggestions("command", "/repo"),
    ]);
    expect(a).toEqual([{ value: "deploy", description: "部署", action: "insert", icon: "slash" }]);
    expect(b).toEqual(a);
    expect(ipcMock.fsWalkFiles).toHaveBeenCalledTimes(2); // 在途去重:两目录各只走一次
    await qoder.listQoderSuggestions("command", "/other");
    expect(ipcMock.fsWalkFiles).toHaveBeenCalledTimes(4); // 新 cwd 重新走盘
  });

  it("command 与 skill 缓存互不串池;skill 描述取 frontmatter", async () => {
    ipcMock.configHomeDir.mockResolvedValue("/home");
    walkResult({ "/repo/.qoder/commands": ["cmd.md"], "/repo/.qoder/skills": ["think/SKILL.md"] });
    readResult({
      "/repo/.qoder/commands/cmd.md": "命令",
      "/repo/.qoder/skills/think/SKILL.md": "---\ndescription: 思考\n---\n",
    });
    const cmds = await qoder.listQoderSuggestions("command", "/repo");
    const skills = await qoder.listQoderSuggestions("skill", "/repo");
    expect(cmds?.map((s) => s.icon)).toEqual(["slash"]);
    expect(skills).toEqual([{ value: "think", description: "思考", action: "insert", icon: "think" }]);
  });
});
