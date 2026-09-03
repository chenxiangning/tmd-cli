# 第六课 · 用户视角 · 多模型协作实战

> 配套主课:[06-multi-model-routing.md](./../06-multi-model-routing.md)
> 这一课解决:**让 omp 在配额撞墙、key (访问密钥) 烧尽时也不挂**。
> 用户视角:config.yml 五段、fallback chain (回退链)、凭据池、path-scoped (按路径限定)、Coding Plan OAuth。

---

## 场景 1 — 最简 config.yml 骨架

**目的**:用最少的几行跑通 omp。

```yaml
# ~/.omp/agent/config.yml
modelRoles:
  default:    claude-sonnet
  reasoning:  claude-sonnet
  advisor:    claude-haiku
```

```bash
# 验证 omp 认这些 role(看到 3 行 = OK)
omp models --roles
```

**期望**:

- 三个 role 都解析成功;
- provider 不写也行,omp 内置 60+ 个 provider 名映射。

---

## 场景 2 — 撞配额不挂:fallback chain

**目的**:当前 model 撞 onQuotaWall (配额墙) 时自动切下一个。

```yaml
# ~/.omp/agent/config.yml
modelRoles:
  default:    [zai:glm-4.6, anthropic:claude-sonnet-4]   # 数组 = fallback chain
  reasoning:  [anthropic:claude-opus, zai:glm-4.6-thinking]
  fast:       claude-haiku
  advisor:    claude-haiku

providers:
  zai:
    apiKey: "${ZAI_API_KEY}"        # GLM Coding Plan
    auth: plan                       # 走套餐,不走按量

  anthropic:
    apiKey: "${ANTHROPIC_API_KEY}"
```

```text
你:跑一个长任务。

agent:zai 配额撞墙 → 自动 fallback 到 anthropic → claude-sonnet-4 → 跑完。
       fallbackChains 记下事件:"zai exhausted at 2026-09-01 03:14"。
```

**期望**:

- 撞 quota (配额) 时**不弹错**,自动切下一个;
- `onQuotaWall` 默认 enable;`onError` 是另一条触发线,处理 API 报错(非 429 类)。

**踩坑提醒**:fallback 链太长 = 烧钱;主+备 + 兜底,3 个就够了。

---

## 场景 3 — 多 key 烧额度不停:credential pool (凭据轮询)

**目的**:把 5 个 Anthropic key 加进来 round-robin (轮流使用,均匀摊到每个 key),被打到 429 (请求过多被拒) 自动换下一个。

```yaml
# ~/.omp/agent/config.yml
providers:
  anthropic:
    apiKeys:        # round-robin
      - "${ANTHROPIC_KEY_1}"
      - "${ANTHROPIC_KEY_2}"
      - "${ANTHROPIC_KEY_3}"
      - "${ANTHROPIC_KEY_4}"
      - "${ANTHROPIC_KEY_5}"
    onRateLimit: rotate   # 429 时轮下一个
```

```bash
# 让 5 个 key 都活着:看 omp 真的轮询
omp test --rotate-key anthropic
```

**期望**:

- 跑大量并发任务时不会"烧死一个 key";
- `omp keys status` 能看到 5 个 key 各自剩多少余额。
- `onQuotaWall` 是另一回事——是"真没额度",会触发 fallback 链;而 429 是"瞬时拥挤",轮下一个即可。

---

## 场景 4 — 实验目录走便宜模型:path-scoped

**目的**:`experiments/` 下面跑 Sonnet 太贵,只在这里限定换成 Haiku。

```yaml
# ~/.omp/agent/config.yml
modelRoles:
  default:    claude-sonnet
  fast:       claude-haiku

scopes:
  - path: "experiments/**"
    modelRoles:
      default:   claude-haiku
      reasoning: claude-sonnet    # 即便实验,复杂推理也别太次
      fast:      claude-haiku
    fallbackChains: []             # 实验目录不指望套餐
```

```text
你:cd experiments/sketch/
   跑这个 prototype。

agent:用 claude-haiku default(因为 path 命中 experiments/** scope);
       reasoning 用 sonnet(配 scope 写明了)。
```

**期望**:

- 跑进 `experiments/` 时模型自动变小;
- 出 `experiments/`,回到全局 config。

**踩坑提醒**:

- path 用 glob (通配符匹配模式),`experiments/**` 包括子目录;
- 别把 path-scoped 写得太宽,否则"省省钱"和"主项目"撞车难查。

---

## 场景 5 — 接 Coding Plan:`/login <provider>`

**目的**:不用贴 API key,一行命令走 OAuth + 套餐额度。

```bash
# 列出 omp 支持的 Coding Plan
omp login --list                # 30+ 个: cursor / kimi / glm / devin / umans ...

# 一行登录
omp login zai                   # GLM Coding Plan(你已经常用)
omp login cursor                # Cursor Coding Plan
omp login kimi                  # Kimi Coding Plan
omp login devin                 # Devin Coding Plan
omp login umans                 # Umans Coding Plan

# 登录后看哪些 model / role 可用
omp models
```

**期望**:

- 浏览器弹授权页(或终端给个手动 URL);
- 套餐额度走专门路由,不烧你按量余额;
- 同时可以多家并存(比如 GLM + Cursor 一起用)。

**踩坑提醒**:

- `auth: plan` vs `auth: apiKey` 是两种模式;登录后 omp 自动写 plan,不用自己改;
- Coding Plan 套餐限制只能用套餐里的 model;API key 路径才能用任意 model。

---

## 场景 6 — 三种真实配方(挑一个照搬)

### 配方 A — GLM Coding Plan 主,Claude 备

```yaml
modelRoles:
  default:    [zai:glm-4.6, anthropic:claude-sonnet-4]
  reasoning:  [anthropic:claude-opus, zai:glm-4.6-thinking]
  fast:       claude-haiku
```

### 配方 B — 多 Anthropic key 烧额度不停

```yaml
providers:
  anthropic:
    apiKeys:
      - "${ANTHROPIC_KEY_1}"
      - "${ANTHROPIC_KEY_2}"
      - "${ANTHROPIC_KEY_3}"
    onRateLimit: rotate

modelRoles:
  default:    anthropic:claude-sonnet
  reasoning:  anthropic:claude-opus
```

### 配方 C — 实验目录走便宜

```yaml
modelRoles:
  default:    claude-sonnet
  reasoning:  claude-opus
  fast:       claude-haiku

scopes:
  - path: "experiments/**"
    modelRoles:
      default:   claude-haiku
      reasoning: claude-sonnet
```

---

## 场景 7 — 调错:小抄

```bash
# 看 omp 现在选的模型
omp models --resolved

# 看 provider 状态
omp provider status

# 看 fallback 链上一次的触发
omp fallbackChains --last-events

# 强制重读 config
omp reload-config
```

| 症状 | 看哪儿 |
| ------ | ------- |
| "我以为用的 opus,实际跑 haiku" | `omp models --resolved` 看每个 role 解析 |
| "突然 fallback 了" | `omp fallbackChains --last-events` 看 onQuotaWall 事件 |
| "key 没用" | `omp provider status` 看环境变量名是不是写错了 |
| "experiments 没切模型" | `omp models --in-path experiments/foo.ts` |

---

## ✅ 这一课你该会的事

1. `~/.omp/agent/config.yml` 五段(modelRoles / providers / fallback / 凭据 / path-scoped)。
2. fallback 链 + `onQuotaWall` —— 撞墙不挂。
3. 凭据池 + `onRateLimit: rotate` —— 多 key 轮询防 429。
4. `scopes[].path` 限定目录用便宜模型。
5. `omp login <provider>` 接 30+ Coding Plan。

---

## 🎯 下一课 →

[07-web-search.md](./07-web-search.md):23 个 provider + 站点感知提取 + GitHub/PyPI/arXiv 安全数据库 handler 一锅炖。
