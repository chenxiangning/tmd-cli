# 第六课 · 用户视角 · 多模型协作实战

> 配套主课:[06-multi-model-routing.md](./../06-multi-model-routing.md)
> 这一课解决:**让 omp 在配额撞墙、key (访问密钥) 烧尽时也不挂**。
> 用户视角:config 骨架、fallback chain (回退链)、多账号轮换、path-scoped (按路径限定)、`/login`。

---

## 场景 1 — 最简 config.yml 骨架

**目的**:用最少的几行跑通 omp。

```yaml
# ~/.omp/agent/config.yml
modelRoles:
  default: anthropic/claude-sonnet-4.5
  advisor: anthropic/claude-haiku-4.5
```

```bash
# 验证路由与模型目录
omp config get modelRoles
omp models ls
```

**期望**:

- role 解析成功;selector 格式是 `provider/model-id`,还能带思考档位后缀(`:high` 等);
- provider 不配也行,omp 内置 60+ 家的目录与凭据解析(7 层:CLI `--api-key` > models.yml > 已存 OAuth > `/login` 存的 key > 环境变量 > 其他已存 key > 兜底)。

---

## 场景 2 — 撞配额不挂:fallback chain

**目的**:主模型 429 (请求过多被拒) 或撞 quota wall (配额墙) 时自动切下一个。

```yaml
# ~/.omp/agent/config.yml
modelRoles:
  default: zai/glm-4.6
  advisor: anthropic/claude-haiku-4.5

retry:
  fallbackChains:
    default:
      - zai/glm-4.6                    # 主
      - anthropic/claude-sonnet-4.5    # 备
      - "minimax/*"                    # provider/* 通配:保模型名换 provider
  fallbackRevertPolicy: cooldown-expiry  # 主模型冷却到期自动切回
```

```text
你:跑一个长任务。

agent:zai 撞墙 → 自动切到 anthropic/claude-sonnet-4.5 接着跑完
       → 冷却到期自动切回主模型。
```

**期望**:

- 撞 quota (配额) 时**不弹错**,链上下一项接手"这一 turn 剩下的部分";
- 溢出 429 与真没额度都会进 fallback;context 溢出则先按 `contextPromotionTarget` 升级大窗口模型。

**踩坑提醒**:fallback 链太长 = 烧钱;主+备+兜底,3 个就够。

---

## 场景 3 — 多账号烧额度不停

**目的**:同一 provider 存多个账号(OAuth 多账号,或 Anthropic/Codex 的多个 org),运行时自动排名轮换,不打断任务。

```bash
# 各账号登录一次
/login anthropic        # 会话内 slash 命令,登录几个账号都行

# 看每个账号的用量与限额
omp usage

# 干跑一轮账号均衡,看它准备怎么分
omp dry-balance
```

**期望**:

- 跑大量任务时不会"烧死一个账号",额度耗尽自动切兄弟账号;
- `omp usage` 能按账号看 5 小时/周窗口的订阅额度;
- 多机共享凭据用 `omp auth-broker serve`(本地凭据保险库)。

**踩坑提醒**:models.yml 里给 provider 写了 `apiKey` 会**故意压过**已存 OAuth(第 2 层 > 第 3 层)——调试"为什么不轮换"先查这里。

---

## 场景 4 — 实验目录限定模型:path-scoped

**目的**:`experiments/` 下面只许用便宜/本地模型。**注意:path-scope 只作用于 `enabledModels` / `disabledProviders` 两个清单,`modelRoles` 不能按路径覆盖。**

```yaml
# ~/.omp/agent/config.yml
providers:
  enabledModels:
    - path: "./experiments/**"
      models: ["anthropic/claude-haiku-*", "ollama/*"]
  disabledProviders:
    - path: "./vendor/**"
      providers: ["anthropic", "openai-codex"]
```

**期望**:

- 跑进 `experiments/` 时,可用模型清单被限定,越界的模型直接不可选;
- 出了目录,回到全局清单。

**踩坑提醒**:

- `disabledProviders` 和模型 provider 共享一个命名空间,`claude`(发现源)≠ `anthropic`(模型 provider);
- 高层配置对数组的覆盖是整体替换,低层的 path 条目会一起没。

---

## 场景 5 — 接 OAuth / Coding Plan:`/login`

**目的**:不用贴 API key,会话内一条命令走账号授权。

```text
/login anthropic           # OAuth 浏览器授权
/login openai-codex        # ChatGPT/Codex
/login github-copilot      # Copilot
/login cursor              # Cursor
/login kimi-code           # Kimi Code(套餐)
/login google-gemini-cli   # Gemini CLI 账号
/login devin               # Devin
/login zai                 # Z.AI / GLM Coding Plan
/login zhipu-coding-plan   # 智谱 Coding Plan(国内)
```

```bash
# 登录态/额度在 CLI 侧管理
omp auth-broker list       # 看已存凭据
omp token zai              # 取某家的 token
omp usage                  # 看限额
```

**期望**:

- 浏览器弹授权页;token 存进 `~/.omp/agent/agent.db`(SQLite);
- 套餐额度走专门路由,不烧按量余额;多家并存没问题。

**踩坑提醒**:`/login` 是**会话内斜杠命令**,不是 `omp login` 子命令;MiniMax/Alibaba/Umans 等 plan 型 provider 走 API key 环境变量(见主课 §7)。

---

## 场景 6 — 三种真实配方(挑一个照搬)

### 配方 A — GLM Coding Plan 主,Claude 备

```yaml
modelRoles:
  default: zai/glm-4.6
  smol:    zai/glm-4.5

retry:
  fallbackChains:
    default:
      - zai/glm-4.6
      - anthropic/claude-sonnet-4.5
      - ollama/qwen2.5-coder     # 本地兜底(免 key 自动发现)
```

### 配方 B — 多 Anthropic 账号轮换

```bash
/login anthropic   # 登录账号 1
/login anthropic   # 再登录账号 2(同一命令登录多次即多账号)
```

```bash
omp dry-balance    # 看轮换计划;运行时自动轮,无需配置
```

### 配方 C — vendor 目录不外发代码

```yaml
providers:
  disabledProviders:
    - path: "./vendor/**"
      providers: ["anthropic", "openai-codex", "google"]
```

---

## 场景 7 — 调错:小抄

```bash
omp config get modelRoles     # 路由写得对不对
omp models ls / find <子串>   # 模型在不在目录里
omp token <provider>          # 凭据解析到了哪一层
omp usage                     # 各账号限额与用量
omp dry-balance               # 多账号轮换计划
```

| 症状 | 看哪儿 |
| ------ | ------- |
| "我以为用的 opus,实际跑 haiku" | `omp config get modelRoles` + 启动 flag 有没有覆盖 |
| "突然 fallback 了" | `omp usage` 看主账号是不是撞窗口了 |
| "key 没用" | `omp token <provider>`;环境变量名对照主课 §7 |
| "experiments 没限定住" | path 条目是不是被高层配置的数组替换吃掉了 |

---

## 这一课你该会的事

1. config 骨架:modelRoles(9 role)/ retry.fallbackChains / path-scoped 两个清单。
2. fallback 链 —— 撞墙不挂,冷却自动切回。
3. OAuth 多账号自动轮换 + auth-broker。
4. `enabledModels` / `disabledProviders` + path 限定目录可用面。
5. `/login <provider>` 接 OAuth/套餐;`omp usage` 看额度。

---

## 下一课 →

[07-web-search.md](./07-web-search.md):23 个 provider + 站点感知提取 + 安全数据库 handler 一锅炖。
