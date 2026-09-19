/**
 * git 视图小模块契约(主文件,并入同族小模块;各自被测面如下):
 *
 * splitCls —— sideBand 本侧色带优先 / 缺侧空带按对侧 kind 减半淡染 / 未知 kind 空串;
 *   HEADER_NW_CLS = HEADER_CLS 追加 whitespace-pre(halves 恒单行),不污染基础表;
 *   正文格 wrap(可换行撑滚动)/ nowrap(恒单行)互斥配对。
 * statusColor —— STATUS_COLOR 状态字母→文字色:M=git-modified、A=diff-inserted、
 *   D/C=diff-removed、R/T=accent、?=fg-faint;表外字母不命中。
 * repoKindMeta —— KIND_META 覆盖 repo/submodule/worktree 全部 kind:repo 无标签,
 *   子模块/工作树带中文标签,三 kind 图标互不相同。
 * gitError —— gitErrorMessage 归一化(Error 取 message/裸串原样/原始值 String 化);
 *   isNotARepo 与 isAuth 按 E_*: 前缀判别且互不误报;gitErrorDisplay 剥前缀留原始描述。
 * gitEvents —— GIT_PREFILL_TOPIC 是 composer 与 git 面板唯一耦合点,值钉死。
 * diffTab —— openDiffTab 经真实 tabs store:id 按 侧+路径 锚定、title/path/payload 装配、
 *   工作区与暂存区各一 tab、重复打开=聚焦且保留首次注册;readDiffTabPayload kind 闸、
 *   缺 cwd/path 拒收、staged/status 兜底默认。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { closeAllTabs, getActiveTabId, getTabs, setActiveTab } from "@kernel/tabs";
import {
  CONTENT_NOWRAP_CLS,
  CONTENT_WRAP_CLS,
  HEADER_CLS,
  HEADER_NW_CLS,
  sideBand,
} from "./splitCls";
import { STATUS_COLOR } from "./statusColor";
import { KIND_META } from "./repoKindMeta";
import { gitErrorDisplay, gitErrorMessage, isAuth, isNotARepo } from "../gitError";
import { GIT_PREFILL_TOPIC } from "../gitEvents";
import { openDiffTab, readDiffTabPayload } from "../diffTab";

describe("sideBand(双栏色带查表)", () => {
  it("本侧行按 kind 命中色带;未知 kind(如 ctx)回空串", () => {
    expect(sideBand({ kind: "del" }, { kind: "add" })).toBe("git-split-band-del");
    expect(sideBand({ kind: "add" }, { kind: "del" })).toBe("git-split-band-add");
    expect(sideBand({ kind: "ctx" }, null)).toBe("");
  });

  it("缺侧空带按对侧 kind 减半淡染;对侧未知或双方皆缺回空串", () => {
    expect(sideBand(null, { kind: "del" })).toBe("git-split-empty-del");
    expect(sideBand(null, { kind: "add" })).toBe("git-split-empty-add");
    expect(sideBand(null, { kind: "ctx" })).toBe("");
    expect(sideBand(null, null)).toBe("");
  });

  it("本侧优先于对侧:有 self 时绝不落空带", () => {
    expect(sideBand({ kind: "add" }, { kind: "del" })).not.toContain("empty");
    expect(sideBand({ kind: "ctx" }, { kind: "del" })).toBe("");
  });
});

describe("HEADER_NW_CLS / 正文格配对", () => {
  it("NW 变体 = 基础样式追加 whitespace-pre,基础表自身不含该类", () => {
    for (const key of ["hunk", "meta"] as const) {
      expect(HEADER_NW_CLS[key]).toBe(`${HEADER_CLS[key]} whitespace-pre`);
      expect(HEADER_CLS[key]).not.toContain("whitespace-pre");
    }
  });

  it("正文格 wrap/nowrap 互斥:wrap 可换行断词,nowrap 恒单行", () => {
    expect(CONTENT_WRAP_CLS).toContain("whitespace-pre-wrap");
    expect(CONTENT_WRAP_CLS).toContain("break-all");
    expect(CONTENT_NOWRAP_CLS).toContain("whitespace-pre");
    expect(CONTENT_NOWRAP_CLS).not.toContain("pre-wrap");
    expect(CONTENT_WRAP_CLS).not.toBe(CONTENT_NOWRAP_CLS);
  });
});

describe("STATUS_COLOR(状态字母→文字色)", () => {
  it("各字母归其语义色:modified/inserted/removed/accent/faint", () => {
    expect(STATUS_COLOR.M).toContain("--tmd-git-modified");
    expect(STATUS_COLOR.A).toContain("--tmd-diff-inserted");
    expect(STATUS_COLOR.D).toContain("--tmd-diff-removed");
    expect(STATUS_COLOR.C).toContain("--tmd-diff-removed"); // 拷贝按删除系淡染
    expect(STATUS_COLOR.R).toContain("--tmd-accent");
    expect(STATUS_COLOR.T).toContain("--tmd-accent"); // 类型变更与重命名同色
    expect(STATUS_COLOR["?"]).toContain("--tmd-fg-faint");
  });

  it("R 与 T 同色(同为改名族);表外字母不命中", () => {
    expect(STATUS_COLOR.R).toBe(STATUS_COLOR.T);
    expect(STATUS_COLOR.X).toBeUndefined();
  });
});

describe("KIND_META(仓 kind 元数据)", () => {
  it("覆盖 repo/submodule/worktree 全部 kind,不缺不溢", () => {
    expect(Object.keys(KIND_META).sort()).toEqual(["repo", "submodule", "worktree"]);
  });

  it("repo 无类型标签;子模块/工作树带中文标签;三 kind 图标互不相同", () => {
    expect(KIND_META.repo.label).toBeNull();
    expect(KIND_META.submodule.label).toBe("子模块");
    expect(KIND_META.worktree.label).toBe("工作树");
    expect(KIND_META.repo.icon).not.toBe(KIND_META.submodule.icon);
    expect(KIND_META.submodule.icon).not.toBe(KIND_META.worktree.icon);
    expect(KIND_META.repo.icon).not.toBe(KIND_META.worktree.icon);
  });
});

describe("gitError(错误归一化与前缀判别)", () => {
  it("gitErrorMessage:Error 取 message、裸串原样、原始值 String 化", () => {
    expect(gitErrorMessage(new Error("E_AUTH: 认证失败"))).toBe("E_AUTH: 认证失败");
    expect(gitErrorMessage("E_NOT_A_REPO: x")).toBe("E_NOT_A_REPO: x");
    expect(gitErrorMessage(42)).toBe("42");
  });

  it("isNotARepo / isAuth 按 E_*: 前缀判别,互不误报;缺冒号不算命中", () => {
    expect(isNotARepo("E_NOT_A_REPO: 不是 git 仓库")).toBe(true);
    expect(isAuth("E_NOT_A_REPO: 不是 git 仓库")).toBe(false);
    expect(isAuth(new Error("E_AUTH: 认证失败"))).toBe(true);
    expect(isNotARepo(new Error("E_AUTH: 认证失败"))).toBe(false);
    expect(isNotARepo("E_NOT_A_REPO 无冒号")).toBe(false);
    expect(isNotARepo("普通报错")).toBe(false);
    expect(isAuth("普通报错")).toBe(false);
  });

  it("gitErrorDisplay 剥掉 E_* 前缀保留原始描述;无前缀原样透传", () => {
    expect(gitErrorDisplay("E_NOT_A_REPO: 不是 git 仓库")).toBe("不是 git 仓库");
    expect(gitErrorDisplay(new Error("E_PUSH_REJECTED: 远端拒绝"))).toBe("远端拒绝");
    expect(gitErrorDisplay("plain message")).toBe("plain message");
  });
});

describe("GIT_PREFILL_TOPIC(composer→面板唯一耦合点)", () => {
  it("主题常量钉死为 git://composer-prefill", () => {
    expect(GIT_PREFILL_TOPIC).toBe("git://composer-prefill");
  });
});

describe("readDiffTabPayload(tab 载荷反读,纯函数)", () => {
  it("非本 kind 或 payload 缺 cwd/path 拒收为 null", () => {
    expect(readDiffTabPayload({ kind: "file", payload: {} })).toBeNull();
    expect(readDiffTabPayload({ kind: "git-diff", payload: null })).toBeNull();
    expect(readDiffTabPayload({ kind: "git-diff", payload: { path: "a.rs" } })).toBeNull();
    expect(readDiffTabPayload({ kind: "git-diff", payload: { cwd: "/ws" } })).toBeNull();
  });

  it("合法载荷透传;staged/status 缺省兜底 false/空串", () => {
    expect(
      readDiffTabPayload({
        kind: "git-diff",
        payload: { cwd: "/ws", path: "src/a.rs", staged: true, status: "M" },
      }),
    ).toEqual({ cwd: "/ws", path: "src/a.rs", staged: true, status: "M" });
    expect(
      readDiffTabPayload({ kind: "git-diff", payload: { cwd: "/ws", path: "src/a.rs" } }),
    ).toEqual({ cwd: "/ws", path: "src/a.rs", staged: false, status: "" });
  });
});

describe("openDiffTab(经真实 tabs store)", () => {
  beforeEach(() => {
    /* store 是模块级单例:经公开 API 清空,保证各例互不污染。 */
    closeAllTabs();
    setActiveTab(null);
  });

  it("装配 tab:id 按 侧+路径 锚定,title/path/payload 齐备并激活", () => {
    openDiffTab({ cwd: "/ws", path: "src/a.rs", staged: false, status: "M" });
    expect(getTabs()).toHaveLength(1);
    const tab = getTabs()[0];
    expect(tab.id).toBe("git-diff:w:src/a.rs");
    expect(tab.kind).toBe("git-diff");
    expect(tab.path).toBe("/ws/src/a.rs");
    expect(tab.title).toBe("src/a.rs — 工作区 diff");
    expect(tab.payload).toEqual({ cwd: "/ws", path: "src/a.rs", staged: false, status: "M" });
    expect(getActiveTabId()).toBe("git-diff:w:src/a.rs");

    openDiffTab({ cwd: "/ws", path: "src/b.rs", staged: true, status: "A" });
    const staged = getTabs()[1];
    expect(staged.id).toBe("git-diff:s:src/b.rs");
    expect(staged.title).toBe("src/b.rs — 已暂存 diff");
  });

  it("工作区与暂存区各占一 tab(同文件 s/w 侧不合并)", () => {
    openDiffTab({ cwd: "/ws", path: "a.rs", staged: false, status: "M" });
    openDiffTab({ cwd: "/ws", path: "a.rs", staged: true, status: "M" });
    expect(getTabs().map((t) => t.id)).toEqual(["git-diff:w:a.rs", "git-diff:s:a.rs"]);
  });

  it("重复打开=聚焦且保留首次注册(title/payload 不被覆盖)", () => {
    openDiffTab({ cwd: "/ws", path: "a.rs", staged: false, status: "M" });
    openDiffTab({ cwd: "/other", path: "a.rs", staged: false, status: "A" });
    expect(getTabs()).toHaveLength(1);
    expect(getTabs()[0].payload).toMatchObject({ cwd: "/ws", status: "M" });
    expect(getActiveTabId()).toBe("git-diff:w:a.rs");
  });
});
