/**
 * ExitSessionNotices 渲染契约测试(node 环境 renderToStaticMarkup):
 * - 标题 = profile 展示名 + 退出码;
 * - 有 cliSessionId 渲染「一键续聊」;shell/无身份不给续聊钮;
 * - 无通知渲染 null。订阅/计时在 ExitSessionToast,此处只验呈现面。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@kernel/host", () => ({
  host: {
    getCliProfile: (id: string) => (id === "omp" ? { id, name: "OMP" } : undefined),
  },
}));
/* 桥在册闸:relayOpenRef.current 非空 = session-relay 插件启用;
   点击行为(开框组源)在桩目检验,node 渲染面只钉存在性。 */
const relayBridge = vi.hoisted(() => ({ current: null as ((d: unknown) => void) | null }));
vi.mock("@kernel/relayBridge", () => ({ relayOpenRef: relayBridge }));

import { ExitSessionNotices } from "./ExitSessionToast";

const BASE = {
  id: 1,
  sessionId: "pty-1",
  profileId: "omp",
  cwd: "/repo",
  exitCode: 1,
  at: 0,
};

describe("ExitSessionNotices", () => {
  it("渲染引擎名标题 + 退出码 + 续聊钮(有磁盘身份时)", () => {
    const html = renderToStaticMarkup(
      createElement(ExitSessionNotices, {
        notices: [{ ...BASE, cliSessionId: "uuid-1" }],
        onClose: () => undefined,
      }),
    );
    expect(html).toContain("OMP 会话异常退出");
    expect(html).toContain("code 1");
    expect(html).toContain("一键续聊");
    expect(html).toContain('role="alert"');
  });

  it("无磁盘身份(shell 等):无续聊钮", () => {
    const html = renderToStaticMarkup(
      createElement(ExitSessionNotices, { notices: [BASE], onClose: () => undefined }),
    );
    expect(html).toContain("OMP 会话异常退出");
    expect(html).not.toContain("一键续聊");
  });

  it("无通知渲染 null", () => {
    expect(renderToStaticMarkup(createElement(ExitSessionNotices, { notices: [], onClose: () => undefined }))).toBe("");
  });
});


describe("退出卡接力入口(跨引擎接力接到失败现场)", () => {
  function renderCli() {
    return renderToStaticMarkup(
      createElement(ExitSessionNotices, {
        notices: [{ ...BASE, cliSessionId: "uuid-1", kind: "cli" }],
        onClose: () => undefined,
      }),
    );
  }

  it("桥在 + CLI 有磁盘身份:渲染接力钮;插件停用(桥 null)即无钮", () => {
    relayBridge.current = () => undefined;
    expect(renderCli()).toContain("转其他引擎接力");
    relayBridge.current = null;
    expect(renderCli()).not.toContain("转其他引擎接力");
  });

  it("ssh 会话不给接力钮:磁盘身份在远端,本地读取器无源", () => {
    relayBridge.current = () => undefined;
    const html = renderToStaticMarkup(
      createElement(ExitSessionNotices, {
        notices: [{ ...BASE, cliSessionId: "uuid-1", kind: "ssh" }],
        onClose: () => undefined,
      }),
    );
    expect(html).not.toContain("转其他引擎接力");
  });
});
