# 第一课 · 用户视角 · 启动、模型、工具调用

> 配套主课:[01-basics.md](./../01-basics.md)
> 这一课只有一件事:**把 omp 跑起来,认得它的脸**。
> 下面每一段都是"用户视角"——只要你照着敲,就能复现主课里讲的同一效果。

---

## 场景 1 — 装包 + 核对版本(5 分钟)

**目的**:从零装好 omp,跟已装的 pi 对一下版本。

```bash
# 1. omp 包名是 @oh-my-pi/pi-coding-agent,装到 Bun 全局
bun install -g @oh-my-pi/pi-coding-agent

# 2. 装完核对一次,看到版本号才算装好
omp --version

# 3. 顺手也验一下你已经装的 pi,后面经常要拿它俩对比
pi --version
```

**期望**:

- 终端打出 `omp` 自己的版本号(类似 `0.x.y`)。
- `pi --version` 输出你之前安装的版本,两边都看得到说明环境没问题。

**小贴士**:`pi-coding-agent`(不带 `@oh-my-pi/` 前缀)就是 pi 的包名,两者都装会共存——靠 `omp` / `pi` 命令区分。

---

## 场景 2 — 第一次 OAuth 登录(走 Coding Plan 套餐)

**目的**:用 Coding Plan 套餐(订阅制,按月给额度,不走按量计费)的额度接入 omp,不用自己贴 API key (模型提供方分给你的访问密钥)。

```bash
# 1. 一行命令,按 provider (模型提供方) 走 OAuth (浏览器授权登录) 或 Coding Plan 套餐路由
omp login                  # 不带参数 = 走自动/默认 provider
omp login zai              # GLM Coding Plan,你已经在用
omp login cursor           # Cursor 套餐
omp login kimi             # Kimi 套餐
omp login devin            # Devin 套餐

# 2. 登录后可以列出"我有权限用的"模型,验证 token (登录令牌) 真活着
omp models                 # 看哪些 role / provider 可用
```

**期望**:

- 浏览器自动弹出授权页,确认后回到终端;
- 命令结束后,omp 把 token 写到 `~/.omp/agent/` 下面的认证目录,下次启动自动用。

**踩坑提醒**:

- 如果浏览器没自动弹,看终端里有没有打印一个 `https://...` URL,手动复制粘贴也行;
- Coding Plan 走的是服务端"套餐判定",所以登录后只能用官方标套餐的模型;走 `--api-key` 是另一条路。

---

## 场景 3 — 启动 TUI (文本用户界面) + Tab 补全

**目的**:进交互界面、装 shell completion (Shell 里按 Tab 自动补全命令),敲 `omp <Tab>` 出选项。

```bash
# 1. 进交互式 TUI (像 vim 一样在里面打字、按 / 切命令)
omp

# 2. 在 TUI 里直接派任务(单次回合,跑完即出)
#    不用进 TUI 也行,见场景 4

# 3. 装 shell 补全:加到 ~/.zshrc(Bun 装了 omp 后,补全脚本在 $BUN_INSTALL/completions)
echo 'source <(omp completion zsh)' >> ~/.zshrc

# 4. 让当前 shell 立即生效
source ~/.zshrc

# 5. 试一下:按 Tab 是不是弹出命令/选项
omp <TAB>
omp lo<TAB>        # 应该补全成 omp login
```

**期望**:

- 重新打开终端后,输入 `omp` 加空格按 Tab,出现子命令和 flag 列表;
- `omp log<TAB>` 自动补成 `omp login`,省得每次都打全。

---

## 场景 4 — 三种启动姿势(交互 / 一次性 / 子命令)

**目的**:实际工作中大多数时候你不需要进 TUI,直接命令行就能干活。

```bash
# A. 一次性派活(类似 pi 的 -p)
omp "看一下 src/auth.ts,告诉我 login 函数是阻塞还是非阻塞的"

# B. 把当前 prompt 灌给 agent(适合复杂长任务)
cat task.md | omp -

# C. 子命令风格(MCP 风格子工具)
omp login                # 走 OAuth / Coding Plan
omp models               # 看可用模型 / role
omp commit               # 原子提交(详见 08 课)
omp web_search "..."     # 直接搜(详见 07 课)
```

**期望**:

- 模式 A 跑完后退出,结果打印到 stdout (标准输出);
- 模式 B 把 stdin (标准输入) 当作 prompt;失败可重试;
- 模式 C 把"高频操作"封装成命令,不用进 TUI。

---

## 场景 5 — 配置 10 个 modelRoles (模型角色)

**目的**:把 omp 的"哪类活派给哪个模型"用 `~/.omp/agent/config.yml` 落地。

```yaml
# ~/.omp/agent/config.yml
modelRoles:
  default:        claude-sonnet            # 日常 80% 任务
  reasoning:      claude-opus              # 复杂推理 / 多步改
  fast:           claude-haiku             # 补全 / 小改
  vision:         gpt-4o                  # 看图
  browse:         gpt-4o-mini             # 抓网页
  bash:           claude-sonnet            # 命令行小帮
  review:         claude-opus              # /review 用
  plan:           claude-opus              # 规划模式
  orchestrate:    claude-opus              # 调子代理
  advisor:        claude-haiku             # 旁听模型(便宜就行)
```

```bash
# 装好配置后,核对一次(看 omp 真的认这些 role)
omp models --roles
```

**踩坑提醒**:

- 字段名必须小写、首字符不能是数字;
- `advisor` 是**每 turn (每回合) 旁听**用的模型,见 03 课,挑个便宜的就行。

---

## 场景 6 — 心智模型对照表(从 pi 切过来的踩坑清单)

**目的**:从 pi 切到 omp,90% 的"诶怎么不一样"都出在这 5 处。

| 场景 | pi 的行为 | omp 的行为 | 用户该怎么做 |
| ------ | ----------- | ------------- | ---------------- |
| 改一行代码 | 重贴整行 + `<<<<<<<` block | hashline 锚点(短哈希码,如 `#3 7qr4`)直接指到行 | 看 02 课,只说"改第几行"就行 |
| 工具命名 | 通用 name (`bash`, `read`, `edit`) | omp 自己的 `tools.*` 名字空间,前缀更明确 | 在 TUI 里 `/tools` 看清单 |
| 配置文件 | `~/.pi/...` | `~/.omp/agent/...` | 别混,`ln -s` 是灾难 |
| Provider 数量 | 较少 | 60+(含 Coding Plan) | 直接 `/login <provider>` 一把梭 |
| 起子代理 | 没原生 fan-out (扇出派发) | `task { workers: 3, schema: ... }` | 看 03 课,用 schema 校验产物 |

**一句话总结**:把 omp 当成"pi 的 IDE-wired (与 IDE 深度打通的) 升级版",而不是 pi 的复刻。

---

## ✅ 这一课你该会的事

1. 装好 omp、跑通 `omp --version`。
2. 走 `omp login zai` 用上 Coding Plan。
3. 配好 shell completion,`omp <TAB>` 出菜单。
4. 知道 3 种启动姿势(交互 / 一次性 / 子命令)。
5. 给 `~/.omp/agent/config.yml` 写好 `modelRoles`。
6. 知道 pi → omp 的 5 大差异,不再踩坑。

---

## 🎯 下一课 →

[02-editing-revolution.md](./02-editing-revolution.md):hashline (按内容哈希锚点) 改一行 + ast_edit + conflict://,再也别 `<<<<<<<` 了。
