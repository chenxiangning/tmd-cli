/** GitHub 链接解析契约:五种输入形态 + 白名单与逃逸防御 + 归档 URL。 */
import { describe, expect, it } from "vitest";
import { githubArchiveUrl, parseGithubSkillUrl } from "./githubImport";

describe("parseGithubSkillUrl", () => {
  it("仓库页 / .git 后缀 / 裸 owner/repo / git@ SSH 四形态", () => {
    expect(parseGithubSkillUrl("https://github.com/anthropics/skills")).toEqual({
      owner: "anthropics",
      repo: "skills",
    });
    expect(parseGithubSkillUrl("https://github.com/anthropics/skills.git")).toEqual({
      owner: "anthropics",
      repo: "skills",
    });
    expect(parseGithubSkillUrl("anthropics/skills")).toEqual({ owner: "anthropics", repo: "skills" });
    expect(parseGithubSkillUrl("git@github.com:anthropics/skills.git")).toEqual({
      owner: "anthropics",
      repo: "skills",
    });
  });

  it("tree/blob 页取首段 ref,子路径忽略", () => {
    expect(parseGithubSkillUrl("https://github.com/anthropics/skills/tree/main")).toEqual({
      owner: "anthropics",
      repo: "skills",
      ref: "main",
    });
    expect(parseGithubSkillUrl("https://github.com/anthropics/skills/tree/v1.0.0/skills/pdf")).toEqual({
      owner: "anthropics",
      repo: "skills",
      ref: "v1.0.0",
    });
    expect(parseGithubSkillUrl("https://github.com/a/b/blob/main/README.md")).toEqual({
      owner: "a",
      repo: "b",
      ref: "main",
    });
  });

  it("空白与尾斜杠容忍;http 与 www 形态", () => {
    expect(parseGithubSkillUrl("  http://www.github.com/a/b/  ")).toEqual({ owner: "a", repo: "b" });
    expect(parseGithubSkillUrl("github.com/a/b/tree/dev/")).toEqual({ owner: "a", repo: "b", ref: "dev" });
  });

  it("拒绝非 github 输入与路径逃逸", () => {
    expect(parseGithubSkillUrl("https://gitlab.com/a/b")).toBeNull();
    expect(parseGithubSkillUrl("/Users/x/local/dir")).toBeNull();
    expect(parseGithubSkillUrl("https://github.com/../etc")).toBeNull();
    expect(parseGithubSkillUrl("")).toBeNull();
    expect(parseGithubSkillUrl("随便说点什么")).toBeNull();
  });

  it("归档 URL:无 ref 用 HEAD,有 ref 单段直拼", () => {
    expect(githubArchiveUrl({ owner: "a", repo: "b" })).toBe("https://github.com/a/b/archive/HEAD.zip");
    expect(githubArchiveUrl({ owner: "a", repo: "b", ref: "v1.0" })).toBe(
      "https://github.com/a/b/archive/v1.0.zip",
    );
  });
});
