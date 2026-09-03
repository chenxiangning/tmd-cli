# 第七课 · 用户视角 · Web search(23 个 provider + 站点感知提取)

> 配套主课:[07-web-search.md](./../07-web-search.md)
> 这一课解决:**让 agent 搜得到的东西比 Google 还"结构化"**。
> 用户视角:auto 模式、site-aware 提取、GitHub/PyPI/arXiv handler、安全数据库 (CVE 漏洞库) 查询。

---

## 场景 1 — 自动模式:auto (无密钥也能跑)

**目的**:不配 key,直接搜——auto 模式挨个 provider 试,任一成功就停。

```text
你:调研一下 "inference-time compute scaling recent papers",
   给我每篇一句话摘要。

agent:web_search {
  query: "inference-time compute scaling recent papers"
}

agent:(
  内部:auto 链 = perplexity → gemini → anthropic → codex → xai → zai → exa → ...
        任一返 200 就停,全失败才报错。
)

agent:
  - "Inference-Time Compute Scaling Laws" (opencode)
    一句话:扩展推理预算能换来准确率显著提升。
  - ...
```

**期望**:

- 不配 provider key 也能搜——auto 模式走 keyless (无密钥) 兜底;
- 你也可以强制某个 provider:`web_search { provider: "exa", query: "..." }`;
- 失败链里会打印每个 provider 的失败原因,排错方便。

**踩坑提醒**:keyless 模式有 rate limit;实在不行就 `omp login <provider>` 接套餐。

---

## 场景 2 — 站点感知:命中 GitHub 自动解析 markdown (结构化文本格式)

**目的**:搜到 GitHub repo,直接拿到 README、issues、release notes 等结构化 markdown,不用再刮一次 HTML。

```text
你:调研 hono 这个 web 框架,准备评估要不要上生产。

agent:web_search {
  query: "hono framework production-ready"
}

agent:自动用 github handler:
  - GitHub repo star / 最近 release / 最新 commit
  - README 摘要(原始 markdown,不是 HTML 转的)
  - open issues 数量 + 高优先级列表
  - recent discussions (10 条热帖)
```

```text
你:hono 的 migration guide v3 → v4 是啥?

agent:web_search {
  query: "site:github.com/honojs/hono migration v3 v4"
}

agent:命中 honojs/hono/blob/main/docs/MIGRATION.md,直接返回 markdown 全文。
```

**期望**:

- 命中 GitHub = 自动走 github handler;
- markdown 结构保留(标题、列表、链接、表格),不是糊成一段 HTML;
- "链接结构"保留——你可以直接命令 agent "点进这条 issue 看回复"。

**踩坑提醒**:搜的时候用 `site:github.com/xxx` 更精准。

---

## 场景 3 — PyPI / npm registry handler

**目的**:查 npm 包的下载量、依赖、license、最新版本 changelog,而不是博客转载。

```text
你:zod 4.0 现在稳定了吗?对比 zod 3。

agent:web_search {
  query: "zod 4 vs zod 3 stability migration"
}

agent:自动用 npm handler:
  - zod@3.x:周下载 5M,当前最新 3.23
  - zod@4.x:周下载 1.2M,当前最新 4.0.5
  - breaking changes: 30+ 处
  - 官方 migration guide (cURL-able markdown)
```

**期望**:

- 拿"厂商数据",不拿"博客评测";
- 自带 README / CHANGELOG markdown;
- 可以直接命令 agent "把 zod 3 升级到 zod 4,按官方 migration guide 走"。

---

## 场景 4 — arXiv 论文复现:不用读 50 页 PDF

**目的**:拿到论文的结构化摘要(abstract) + 关键章节,跳过正文。

```text
你:看一下 "Sparks of AGI" 论文的核心结论。

agent:web_search {
  query: "Sparks of AGI: Early experiments with GPT-4 arxiv"
}

agent:走 arxiv handler:
  - abstract (论文摘要)
  - 章节大纲 + 每章 1 行核心数字
  - 关键图表引用 (Figure / Table)
  - BibTeX (可直接粘贴到论文 ref)
```

**期望**:

- 不读 50 页就能"听 agent 复述一遍";
- 关键数字 / 数据集大小 / 训练规模都列出来;
- 想看原文,直接命令 agent "打开 Section 4.2"。

---

## 场景 5 — 安全审计:查 CVE (公开漏洞编号)

**目的**:看自己用的库有没有暴露的漏洞。

```text
你:我们用了 axios 0.27.x,有没有未修的高危 CVE?

agent:web_search {
  query: "axios 0.27 CVE advisory nvd osv"
}

agent:走 NVD/OSV/Github-Advisory 三个 handler:
  - NVD (美国国家漏洞库): CVE-2023-45857 severity=HIGH (CSRF)
  - OSV (开源漏洞数据库): 同一 CVE 数据
  - GitHub Security Advisory: fix 0.28.0 / patch 0.27.3
```

**期望**:

- "返回 3 个数据库的实际厂商数据"——不是博客摘要;
- 影响范围 / 修复版本 / patch 路径都对齐;
- agent 直接告诉你"升级到 0.28.0 / 临时回退 / 用 patch 0.27.3"。

**踩坑提醒**:CVE 的修复版本号要"自己再核一遍"(厂商数据有时滞后)。

---

## 场景 6 — CI 报错查 issue

**目的**:CI 跑挂、报某个怪异 error,看是不是别人也踩过。

```text
你:这个 CI 错离谱,我看不出原因:
   "Error: EINVAL: invalid argument, read ECONNRESET at TLSSocket"

agent:web_search {
  query: "EINVAL invalid argument ECONNRESET TLSSocket github issue"
}

agent:命中多个 issue / discussion:
  - act-org/act#1822 (closed, fix in v0.2.50)
  - actions/runner#2456 (open, work around = retry)
  - 你依赖项某个版本踩到 bug
```

**期望**:

- 命中"实战 issue"——不是 Stack Overflow 通用回答;
- 自己能直接命令 agent "升级 act 到 v0.2.50 试试"。

---

## 场景 7 — 调优:改 provider 优先级

```yaml
# ~/.omp/agent/config.yml
webSearch:
  providerChain: [exa, perplexity, gemini, anthropic]
  siteAware:
    github:  true   # 命中 GitHub 自动解析 markdown
    pypi:    true
    npm:     true
    arxiv:   true
    nvd:     true
  keyless:
    fallbackProvider: duckduckgo   # keyless 兜底
```

**期望**:

- `providerChain` 控制 auto 模式的优先序;
- `siteAware` 单独开关某个 handler;
- `keyless.fallbackProvider` 兜底(全失败 / 没配 key 时走它)。

---

## ✅ 这一课你该会的事

1. `web_search { query }` 走 auto chain (无 key 也能跑)。
2. GitHub / npm / arxiv 命中自动开 handler,markdown 拿到。
3. `site:github.com/xxx` 精确限位。
4. 安全审计走 NVD/OSV/Github-Advisory,拿到厂商数据。
5. 调优 `webSearch.providerChain` 和 `siteAware`。

---

## 🎯 下一课 →

[08-omp-commit.md](./08-omp-commit.md):`omp commit` 原子提交 + 依赖排序:周末改了一堆,周一让它自动按依赖图拆 commit。
