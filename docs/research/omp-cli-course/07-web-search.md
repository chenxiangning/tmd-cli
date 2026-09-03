# 第七课:Web search 内置 —— 23 个 provider + 站点感知提取

这是 omp 的 08 号电池。在 pi 里你需要自己接 MCP (Model Context Protocol, 模型上下文协议) 或外部 search 工具,omp 直接内置——并且把"读网页"做成"读本地文件"的同一套体验。

## 1. 一句话定位

```
pi:  agent 想查 web → 你得自己接 search MCP 或 web_fetch
omp: agent 想查 web → web_search tool → 拿到答案 + 带引用的来源
                     → read <url> → 结构化 markdown
```

上游 README 的说法:"web_search chains twenty-three ranked providers and hands whatever URLs it finds straight to read. Arxiv PDFs, GitHub pages, Stack Overflow threads come back as structured markdown with anchors intact — the same tool surface you use on local files. Cite, follow, quote, never lose where you came from."

## 2. 23 个 provider 全清单

| provider | auth (鉴权方式) | 备注 |
| ---------- | --------- | ------ |
| `auto` | 链式调用 | **默认**,按下面顺序逐个试 |
| `perplexity` | `PERPLEXITY_API_KEY`(无 key 可走匿名 fallback) | AI 综合答案 |
| `gemini` | OAuth | Google Gemini 搜索 |
| `anthropic` | OAuth | Anthropic 搜索 |
| `codex` | OAuth | OpenAI Codex 搜索 |
| `xai` | OAuth 或 `XAI_API_KEY` | xAI Grok 搜索 |
| `zai` | `ZAI_API_KEY` | GLM 搜索 |
| `exa` | `EXA_API_KEY`(或 MCP) | 向量搜索 |
| `tinyfish` | `TINYFISH_API_KEY` | |
| `jina` | `JINA_API_KEY` | Jina 搜索 |
| `kagi` | `KAGI_API_KEY` | Kagi 搜索 |
| `tavily` | `TAVILY_API_KEY` | Tavily 搜索 |
| `firecrawl` | `FIRECRAWL_API_KEY`(keyless fallback) | 爬虫式 |
| `brave` | `BRAVE_API_KEY` | Brave Search |
| `kimi` | `/login kimi-code` 或 search key | Kimi 搜索 |
| `parallel` | `PARALLEL_API_KEY` | Parallel 多源 |
| `synthetic` | `SYNTHETIC_API_KEY` | Synthetic |
| `searxng` | self-hosted (自托管) | 需自己跑 SearXNG 实例 |
| `duckduckgo` | 无 key | DDG |
| `startpage` | 无 key | Startpage |
| `google` | 无 key (browser 兜底) | Google |
| `ecosia` | 无 key (browser 兜底) | Ecosia |
| `mojeek` | 无 key (browser 兜底) | Mojeek |
| `public` | 无 key | 上面公共源的合并(**只在显式点名时用,auto 链不会选它**) |

### 2.1 `auto` 模式怎么走

```text
web_search { query: "..." }
→ auto 链:perplexity → gemini → anthropic → codex → xai → zai → exa → ...
→ 顺序是固定的,串行 fallback(不是并行 fan-out),任一成功就停,全部失败才报错
```

- 失败不会抛异常,而是以 `Error: ...` 文本返回,agent 能读着继续想办法
- 每个 provider 的单次超时由 `providers.webSearchTimeoutSeconds` 控制(默认 60s,上限 300s)——不是整条链的总时限
- 想固定用某一家,按名字 pin 它,不必走 auto

### 2.2 keyless (无密钥) 也能用

`duckduckgo` / `startpage` / `google` / `ecosia` / `mojeek` 这 5 个加 `public` **完全不要 key**:

- 你没买 Tavily/Perplexity 也能搜
- 但 AI 综合/高质量引用这些**只有付费 provider 提供**

### 2.3 Exa 的特殊双通道

Exa 除 `EXA_API_KEY` 外还接受 MCP 通道或 `/login exa` 存 key;显式选 keyless 时走 public MCP fallback。

### 2.4 真实参数

```text
web_search {
  query: "inference-time compute scaling site:arxiv.org after:2026-01-01",
  recency: "year",          # day|week|month|year(部分 provider 才认)
  limit: 10,                # 结果条数
  num_search_results: 8     # 部分 provider 支持的原始结果数
}
```

- `query` 支持 Google 风格操作符:`site:` / `after:` / `before:` / `inurl:` / `intitle:` / `"exact phrase"` / `-term` / `OR`
- 注意:**没有** `site:` 或 `sources:` 这样的独立参数——站点定位写进 query,数据源选择靠 pin provider
- `recency`/`max_tokens`/`temperature` 是"尽力而为":不少 adapter 会忽略

## 3. site-aware extraction (站点感知提取) ——杀手锏

普通 web search 返回 "10 个蓝色链接"。omp 的分工是:**search 找 URL,`read` 按 URL 来源调对应 extractor (提取器)**,转成结构化 markdown。

### 3.1 抓回来什么样

```text
[agent 调用]
web_search { query: "inference-time compute scaling recent papers" }
→ 拿到带引用的来源列表

read https://arxiv.org/abs/2604.10739v1
→ arxiv 处理:摘要 + 正文 markdown,PDF 也能直接 read
→ "# Inference-Time Compute Scaling Laws / Smith et al. (2026) / ## Headline Result ..."

read https://github.com/anomalyco/opencode
→ GitHub 处理:repo 元数据 + README

read https://www.npmjs.com/package/zod
→ npm 处理:包元数据 + README
```

每个链接的页面都按其来源**最优形式**返回:

- arxiv → 摘要 + PDF markdown 转换
- GitHub → repo 元数据 + README(PR/issue 走 `pr://`、`issue://` 更快,第十一课)
- npm → 包元数据 + README
- SO → 问题 + 高票答案

### 3.2 链接结构保留

```markdown
详情见 [Anthropic 的 MCP 文档](https://modelcontextprotocol.io/docs)
            ↑
      anchor (锚点) 完整保留
```

agent 可以 cite (引用)、follow、quote,**不会丢失上下文**——README 原话 "agent gets structured content, not stripped HTML"。

## 4. Specialized handlers (专业处理器)

omp 按来源分 5 类,每类有专属处理:

### 4.1 Code hosts (代码托管平台)

| handler | 干什么 |
|---------|--------|
| `github` | repo / PR / issue / code search / Actions run-watch(`github` 工具与 `pr://` 的近亲) |
| `gitlab` | 同上(GitLab 版) |

### 4.2 Package registries (包注册中心)

| handler | 平台 |
| --------- | ------ |
| `npm` | Node 包 |
| `pypi` | Python 包 |
| `crates` | crates.io (Rust 包仓库) |
| `hex` | Erlang/Elixir |
| `hackage` | Haskell |
| `nuget` | .NET |
| `maven` | Java |
| `rubygems` | Ruby |
| `packagist` | PHP |
| `pub.dev` | Dart |
| `go` | Go packages |

### 4.3 Research sources (研究来源)

| handler | 平台 |
|---------|------|
| `arxiv` | 学术预印本(PDF 直接转 markdown) |
| `semantic-scholar` | 学术搜索 |

### 4.4 Forums (论坛)

| handler | 平台 |
| --------- | ------ |
| `stackoverflow` | SO |
| `reddit` | Reddit |
| `hn` | Hacker News |

### 4.5 Docs (文档)

| handler | 平台 |
| --------- | ------ |
| `mdn` | Mozilla 开发者网络 |
| `readthedocs` | Read the Docs |
| `docs.rs` | Rust 文档 |

### 4.6 用法

```text
read https://arxiv.org/abs/2604.10739v1
→ 自动按 arxiv 处理,不走 search
```

handler 是**按 URL 自动路由**的——agent 不用声明"这是 arxiv"。

## 5. Security databases (安全数据库) 集成

这是 web 能力的另一面——查漏洞拿厂商原始数据,不是博客摘要:

| database | 用途 |
| ---------- | ------ |
| NVD | National Vulnerability Database (国家漏洞数据库) |
| OSV | Open Source Vulnerabilities (开源漏洞库) |
| CISA KEV | CISA Known Exploited Vulnerabilities (已知被利用漏洞目录) |

```text
[用户]
next-auth 有没有已披露的 CVE?影响哪些版本?

[agent]
web_search { query: "next-auth CVE advisory site:github.com/advisories" }
read <拿到的 advisory 链接>
→ 结合 package.json 里的版本告诉你受不受影响
```

## 6. 实战工作流

### 场景 1:调研一个新库

```text
web_search { query: "Bun vs Node.js performance benchmarks 2026" }
read https://github.com/oven-sh/bun      # github 处理
read https://bun.sh/docs                 # docs 处理
```

### 场景 2:安全审计

```text
web_search { query: "next-auth CVE vulnerability advisory" }
read <advisory URL>
→ 厂商漏洞数据,直接告诉你版本是否受影响
```

### 场景 3:CI 出错查 issue

```text
web_search { query: "rust-analyzer error E0599 method not found" }
read <命中 issue 的 URL>
→ issue/PR/答案,直接拿到 markdown
```

### 场景 4:论文复现

```text
read https://arxiv.org/pdf/2604.10739v1
→ arxiv 处理返回关键章节 + 实验数字
→ 不用读 50 页 PDF,直接 cite 关键结论
```

## 7. 调优与排错

```bash
omp search "zod 文档"          # CLI 直接测试 provider(别名 omp q)
```

- 单 provider 超时:`providers.webSearchTimeoutSeconds`
- provider 可用性 = 有凭据(或 keyless)+ 未被 `disabledProviders` 挡住(第六课的 path-scope 在这也能用:"vendor 目录禁掉某个 search 源")
- 结果质量差时:换 query 操作符(`site:`/`after:`),或 pin 一家付费源对比

## 8. 与 pi 的全景对比

| 维度 | pi | omp |
| ------ | ----- | ----- |
| 内置 web search | ❌ | ✅ 23 provider |
| `auto` 链 | n/a | ✅ 固定顺序串行 fallback |
| keyless 选项 | n/a | ✅ 6 个 |
| 站点感知提取 | ❌ | ✅ search + read 联动,5 类 handler |
| 学术论文 markdown | ❌ | ✅ arxiv(含 PDF) |
| 漏洞厂商数据 | ❌ | ✅ NVD / OSV / CISA KEV |
| 与本地工具统一 | n/a | ✅ `read https://...` 像读文件 |

## 小结

| 能力 | 干什么 |
| ------ | -------- |
| 23 provider | 涵盖付费 / OAuth / keyless / self-hosted |
| `auto` 链 | 固定顺序,串行 fallback,失败返回 Error 文本 |
| 真实参数 | query(支持 site:/after: 等操作符)/ recency / limit |
| site-aware extraction | read 按 URL 来源走专属 handler,锚点保留 |
| Security databases | NVD / OSV / CISA KEV 厂商原始数据 |

和 pi 的对照:**pi 搜到的是"链接列表",omp 搜到的是"已经读完的结构化 markdown"**。

## 下一课预告:第八课:`omp commit` 与 git 集成

- `omp commit`:自动写 message + 更新 changelog
- 上游 README 说的"原子拆分"是怎么回事
- `omp git` 交互式 git UI、`pi-vcs` 双后端(Git + Jujutsu)
