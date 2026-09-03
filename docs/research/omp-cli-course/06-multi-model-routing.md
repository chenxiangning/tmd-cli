# 第六课:多模型协作实战 —— provider/role/凭据/fallback 全配置

第一课提过 modelRoles (模型角色) 是 omp 和 pi 的最大心智差异。这一课**深入到运维层面**,讲真实生产里 60+ provider (模型提供方) 怎么用得稳。

## 1. 全局视角:omp 怎么决定"这次 turn 用哪个模型"

```
┌────── 用户启动 ──────┐
│ omp --smol gpt-5.5-mini "扫日志" │
└──────────────┬──────────────┘
               ▼
┌── role 选择 ──────────────┐
│ 有 --smol → 覆盖 smol role │
│ 没 flag → default role     │
└──────────────┬──────────────┘
               ▼
┌── modelRoles 路由 ────────────┐
│ modelRoles.smol: anthropic/claude-haiku-4.5 │
│ → provider: anthropic, model: claude-haiku-4.5 │
└──────────────┬──────────────┘
               ▼
┌── 凭据解析(7 层,先到先得)─────────────┐
│ --api-key > models.yml apiKey > 已存 OAuth │
│  > /login 存的 key > 环境变量 > 其他已存 key │
│  > 兜底解析器                              │
└──────────────┬──────────────┘
               ▼
┌── retry / fallback 链 ─────────────┐
│ 撞墙 → fallback chain 下一项接手    │
│ 多账号 → 自动轮换                   │
└──────────────┬──────────────┘
               ▼
            发请求
```

任何一步都可能影响最终"哪把钥匙、调哪个地址、撞墙后找谁"。

## 2. 完整 config.yml 骨架

```yaml
# ~/.omp/agent/config.yml

# ─────── 1. 模型角色路由(9 个 role)───────
modelRoles:
  default: openai-codex/gpt-5.5
  smol:    anthropic/claude-haiku-4.5
  slow:    anthropic/claude-opus-4.7
  plan:    anthropic/claude-opus-4.7
  commit:  openai-codex/gpt-5.5
  advisor: anthropic/claude-sonnet-4.5
  vision:  google/gemini-3-flash
  task:    anthropic/claude-haiku-4.5
  tiny:    anthropic/claude-haiku-4.5

# ─────── 2. 自定义 provider(写在 models.yml,见 §6)───────

# ─────── 3. 重试与回退链 ───────
retry:
  modelFallback: true            # 默认就是 true
  fallbackChains:
    default:                     # 按 role 配链
      - openai-codex/gpt-5.5     # 主
      - anthropic/claude-opus-4.7
    smol:
      - anthropic/claude-haiku-4.5
      - "minimax/*"              # provider/* 通配:保模型名,换 provider
  fallbackRevertPolicy: cooldown-expiry  # 冷却到期自动切回主模型(或 "never")
  maxRetries: 10                 # 默认 10
```

配置文件优先级(低→高):内置默认 < 全局 `~/.omp/agent/config.yml` < 项目 `<cwd>/.omp/config.yml` < `PI_CONFIG_FILES`/`--config` 叠加 < 运行时覆盖。**数组合并是整体替换,不是追加**——最常见的坑。

## 3. Fallback Chain (回退链) —— 撞墙不挂

### 3.1 触发场景

| 场景 | 表现 |
| ------ | ------ |
| 主 provider 429 (请求过多) | 立刻切下一个 |
| 主 provider 5xx / 网络断 | 重试 N 次 → 切下一个 |
| Quota wall (配额墙) | 冷却计时,到期自动恢复主模型 |
| context 溢出 | 先按 `contextPromotionTarget` 升级到大窗口模型,再考虑压缩 |
| 模型拒绝输出 | 不算撞墙,正常回传 |

### 3.2 fallback 链行为

```
发请求到 openai-codex/gpt-5.5
  → 429 Too Many Requests
  → 切到 anthropic/claude-opus-4.7,把"这一 turn 剩下的部分"交给它
  → 主模型冷却到期后自动切回(fallbackRevertPolicy)
```

注意:**不是重发同一个请求,是把"剩余的对话"交给下一个模型**。omp 内部用统一消息格式转发,模型厂商无关。内置策略还会在 Codex 系模型间升级(`codex-spark → gpt-5.5 → gpt-5.4`)。

## 4. 凭据:多账号轮换与凭据池

### 4.1 事实:轮换是自动的

- **同一 provider 存了多个 OAuth 账号**(比如两个 Claude 账号,或同账号的多个 org/workspace——Anthropic/Codex 按 org 分账号计数):运行时自动**排名 + 轮换**,额度耗尽切兄弟账号
- `omp dry-balance` 可以**干跑**一轮账号均衡,看它准备怎么分
- `omp usage` 能看每个已认证账号的用量/限额(订阅套餐的 5 小时/周窗口也在里面)

### 4.2 auth-broker:多机共享凭据池

多台机器/多个 agent 进程共享账号时,起一个本地凭据保险库:

```bash
omp auth-broker serve       # 默认 127.0.0.1:8765
# 客户端设 OMP_AUTH_BROKER_URL 后,本地 SQLite 凭据库被远端 vault 替代
```

- account pool 文件(`OMP_AUTH_BROKER_ACCOUNT_POOL_FILE`)可以按 provider 指定允许用哪几个账号身份——这是**路由策略,不是安全边界**
- auth-gateway(默认 127.0.0.1:4000)是基于 broker 的转发代理,给不支持多 base URL 的工具用

### 4.3 API key 池

上游 README 的说法:"Stack API keys per provider and the runtime rotates with session affinity (会话粘性,同一会话尽量绑同一凭据,保 prompt cache) and per-credential backoff (单凭据退避)。" 文档层可验证的机制就是 §4.1 的多账号轮换;具体 key 池的配置键名以 `omp config list` 的实际输出为准,别照抄网上 YAML。

### 4.4 与 pi 对比

| | pi | omp |
| --- | ----- | ----- |
| fallback chain | 手动 `--model` 切 | ✅ 按 role/model/provider 通配自动 |
| 多账号轮换 | ❌ | ✅ 自动(含 org 级拆分) |
| 凭据共享 | n/a | ✅ auth-broker/gateway |

## 5. Path-scoped Models (按路径限定模型) —— 只限"允许清单"

**关键事实:path-scope 只作用于 `enabledModels` 和 `disabledProviders` 两个清单,`modelRoles` 不能按路径覆盖。**

```yaml
providers:
  enabledModels:
    - path: "./apps/experimental/**"   # 该目录及子目录
      models: ["minimax/*", "ollama/*"]  # 只许便宜/本地模型
    - models: ["anthropic/*"]          # 不带 path = 全局生效
  disabledProviders:
    - path: "./vendor/**"
      providers: ["anthropic", "openai-codex"]  # vendor 目录不调这两家
```

- 路径键:`path`/`paths`/`pathPrefix`/`pathPrefixes`;cwd 在路径下就生效
- 值键:`models`(= enabledModels)/`providers`(= disabledProviders)/`values`(两者皆可)
- `disabledProviders` 是一个共享命名空间:既挡模型 provider(`anthropic`),也挡发现源(`claude`/`codex`/`gemini` 这些**发现 provider** 与模型 provider 不是一回事)
- 叠加规则:清单在高层配置里被整体替换时,低层的 path 条目会一起丢——配置分层时留心

## 6. models.yml:自定义 provider 与 60+ 内置

自定义 OpenAI 兼容端点写在 `~/.omp/agent/models.yml`:

```yaml
providers:
  spark:
    baseUrl: http://192.168.10.223:8000/v1
    api: openai-completions     # 另有 openai-responses / anthropic-messages /
                                # google-generative-ai / bedrock-converse-stream 等 9 种
    apiKey: dummy               # 可以是环境变量名,或 "!cmd" 跑命令取 key
    models:
      - id: minimax-m3
        name: MiniMax M3
        contextWindow: 100000
```

`omp models spark` 验证发现;然后 `/model` 里把它指给某个 role。本地引擎(Ollama/LM Studio/llama.cpp/vLLM)免 key 自动发现。

## 7. /login 与 Coding Plan

```text
/login anthropic           # OAuth 浏览器登录
/login openai-codex        # ChatGPT/Codex 账号
/login github-copilot      # Copilot
/login cursor              # Cursor
/login kimi-code           # Kimi Code(套餐)
/login qwen-portal         # 通义千问 Portal
/login google-gemini-cli   # Gemini CLI 账号
/login devin               # Devin
/login gitlab-duo          # GitLab Duo
/login xai-oauth           # xAI 账号
/login zai                 # Z.AI / GLM Coding Plan(API key 形态)
/login zhipu-coding-plan   # 智谱 Coding Plan(国内端点)
```

- 文档明确支持 `/login` 的 OAuth provider 就是上面这批;上游 README 的"Coding plans"栏还列了 MiniMax/Alibaba/Umans/Xiaomi MiMo/Qianfan 等——均为 `plan` 标签路由,总数是"60+ providers"的一部分,不存在"30+ 全 OAuth"的清单
- token 存在 `~/.omp/agent/agent.db`(SQLite),不是明文 json;`secrets.yml` 的占位脱敏默认**关**(`secrets.enabled: false`),要自己开
- 登录态管理:`omp auth-broker list`(看凭据)、`omp token <provider>`(取 token)、`omp usage`(看限额)

## 8. 调试 / 排错

```bash
omp config list             # 看生效配置(含来源)
omp config get modelRoles   # 取某个键
omp config path             # 配置文件都在哪
omp models ls / find <子串> / refresh   # 模型目录排查
omp token <provider>        # 凭据解析到哪一层了
omp usage                   # 每账号用量与限额
omp dry-balance             # 干跑多账号均衡
```

实战排错流程:

1. `omp config get modelRoles` 确认路由正确
2. `omp models ls` 确认模型在目录里(自定义 provider 先 `omp models <provider>` 验证发现)
3. `omp token <provider>` / `omp usage` 确认凭据层与配额
4. 看 fallback 行为:`retry.fallbackChains` 写没写对、`fallbackRevertPolicy` 是不是符合预期

## 9. 与 pi 的全景对比

| 维度 | pi | omp |
| ------ | ----- | ----- |
| Model roles | 1(当前模型) | ✅ 9 |
| Fallback chain | ❌ | ✅ role/model/provider 通配 + 自动切回 |
| 多账号轮换 | ❌ | ✅ OAuth 多账号自动排名轮换 |
| 凭据池/代理 | n/a | ✅ auth-broker + auth-gateway |
| Path-scoped 模型 | ❌ | ✅(仅 enabledModels/disabledProviders) |
| `/login` 一键接入 | 部分 | ✅ OAuth + 套餐双轨 |

## 小结

| 配置块/命令 | 干什么 | 关键值 |
| -------- | -------- | -------- |
| `modelRoles` | 按角色路由(9 role) | default / smol / slow / advisor / ... |
| `retry.fallbackChains` | 撞墙自动切 | 按 role / `provider/model` / `provider/*` |
| 多账号轮换 + broker | 凭据不中断 | `omp dry-balance` / `auth-broker serve` |
| `enabledModels`/`disabledProviders` + path | 按路径限模型 | 只有这两个清单能 path-scope |
| `/login <provider>` | OAuth/Coding Plan | token 进 agent.db |

和 pi 的对照:**pi 是"一个模型跑到底",omp 是"60+ provider 路由成一张网"**。这就是 README 里 "60+ providers, a thousand models, one /model away" 的真正含义。

## 下一课预告:第七课:Web search 内置

- 23 个 search providers 全清单(perplexity / tavily / exa / kagi / jina / brave / kimi / ...)
- `auto` 链式调用:按固定顺序逐个试,任一成功即停
- site-aware extraction (站点感知提取) 怎么把 arxiv / GitHub / npm 自动转成结构化 markdown
