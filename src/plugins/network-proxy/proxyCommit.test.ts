/**
 * 网络代理编辑器校验契约测试。
 * 覆盖:默认地址回落、地址归一(关闭态留空)、格式/协议/主机名失败分支、
 * http(s) 与 socks5 合法输入放行(与 Rust proxy.rs 的 reqwest 校验同构)。
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROXY_URL,
  normalizeProxyUrl,
  proxyTransitionError,
} from "./proxyCommit";

describe("normalizeProxyUrl", () => {
  it("启用态空地址回落默认地址", () => {
    expect(normalizeProxyUrl("", true)).toBe(DEFAULT_PROXY_URL);
    expect(normalizeProxyUrl("   ", true)).toBe(DEFAULT_PROXY_URL);
    expect(DEFAULT_PROXY_URL).toBe("http://127.0.0.1:7890");
  });

  it("关闭态空地址保留空(不硬塞默认)", () => {
    expect(normalizeProxyUrl("", false)).toBe("");
  });

  it("非空地址仅 trim", () => {
    expect(normalizeProxyUrl("  socks5://127.0.0.1:1080  ", true)).toBe(
      "socks5://127.0.0.1:1080",
    );
    expect(normalizeProxyUrl("  http://127.0.0.1:7890  ", false)).toBe(
      "http://127.0.0.1:7890",
    );
  });
});

describe("proxyTransitionError", () => {
  it("空串放行(空/留空语义归 normalizeProxyUrl)", () => {
    expect(proxyTransitionError("")).toBeNull();
    expect(proxyTransitionError("   ")).toBeNull();
  });

  it("非 URL 报错", () => {
    expect(proxyTransitionError("not a url")).toMatch(/格式无效/);
    expect(proxyTransitionError("127.0.0.1:7890")).toMatch(/格式无效/);
  });

  it("不支持的协议报错", () => {
    expect(proxyTransitionError("ftp://127.0.0.1:21")).toMatch(/不支持/);
  });

  it("http(s) 与 socks5 放行", () => {
    expect(proxyTransitionError("http://127.0.0.1:7890")).toBeNull();
    expect(proxyTransitionError("https://proxy.corp.example:8443")).toBeNull();
    expect(proxyTransitionError("socks5://127.0.0.1:1080")).toBeNull();
    expect(proxyTransitionError("socks5h://proxy.example")).toBeNull();
  });

  it("前后空白容忍(trim 后校验)", () => {
    expect(proxyTransitionError("  http://127.0.0.1:7890  ")).toBeNull();
  });
});
