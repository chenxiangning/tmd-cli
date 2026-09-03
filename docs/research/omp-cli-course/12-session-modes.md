# 第十二课:Session 控制 + magic keywords

Session-level (会话级) 控制和 magic keyword (魔法关键字)——这些**不是工具调用**,是"说一句话就生效"。

## 1. `/vibe` 模式(只读 director 模式)

### 1.1 心智模型

```
普通模式:
  你 ↔ omp(读、写、跑命令、改文件)
  → 你直接看 agent 干活

/vibe 模式:
  你 ↔ director(只读,你看过不过)
           │
           ├── worker 1(读 + 写)
           ├── worker 2(读 + 写)
           └── worker 3(读 + 写)
  → director 派活,worker 真干,你看 director 的总结
```

director 自己是**只读**——工具集被砍到只剩 `read` 和一组 vibe 专用工具(`vibe_spawn`/`vibe_send`/`vibe_wait`/`vibe_kill`/`vibe_list`),**不能 write/edit/bash**——保证你的代码不被 director 直接碰。

### 1.2 进入方式

```text
`/vibe`               # 进入 vibe mode(再输一次 /vibe 退出)
`/vibe <prompt>`      # 进入并直接下第一道指令
worker 分两档:fast → 内置 sonic agent(跑 @smol 便宜模型);good → 内置 task agent(跑 @task)
```

### 1.3 工作流

```text
[你] /vibe
[director] 收到。已激活 vibe mode。
  - 我只读,不直接改代码
  - 我会派 worker 改,结果会让我过目
  - 我确认后才会"落盘"到你看到的代码里
[你] 给 src/auth/ 加 rate limiting

[director 思考,派 worker]
worker 1: 改 src/auth/login.ts 加限流
worker 2: 改 src/auth/middleware.ts 配限流参数
worker 3: 写 test 验证限流

[director 看 worker 产出]
worker 1: ✅ 用了 token bucket,看着合理
worker 2: ✅ 用 env (环境变量) 配 limit,合理
worker 3: ✅ 测试覆盖了主要 case

[director 总结给你]
"3 个 worker 完成,改动:
  - login.ts:加 rate-limit 中间件
  - middleware.ts:从 env 读 RATE_LIMIT_PER_MIN
  - auth.test.ts:加 3 个测试用例
  要 apply 吗?"

[你] apply
[worker 们的改动落盘]
```

### 1.4 与 pi 对比

| | pi | omp `/vibe` |
| --- | ----- | ----- |
| Director + worker 模式 | ❌ | ✅ |
| Director 只读保证 | n/a | ✅ 工具集限制 |
| 派 fast/good worker | ❌ | ✅ |
| 你审批才落盘 | ❌ | ✅ |

## 2. `/fresh` 重置流状态

### 2.1 触发场景

| 现象 | 原因 |
| ------ | ------ |
| Provider 流卡住不出字 | 网络/服务端 stale state |
| 模型重复说同一段 | prompt cache (提示缓存) 损坏 |
| 流突然中断但 token 已扣 | stream 状态错乱 |
| 切换 model 想"清空对话缓存" | 避免跨模型语义污染 |

### 2.2 工作流

```text
/fresh

# 内部效果:
1. 重置 provider 侧的流状态(新的 provider session id)
2. 重新 keyed 的 prompt cache,作废 append-only 上下文
3. 本地 transcript (本地对话转录)、文件、身份全部保留
4. 等价于"心跳重启",但你不用退出 session
```

### 2.3 与 pi 对比

| | pi | omp |
| --- | ----- | ----- |
| 流重置 | ❌(只能重启 session) | ✅ `/fresh` |
| 保 transcript | n/a | ✅ |

## 3. `/model` slash 命令

### 3.1 切换当前 role 模型

```text
/model                           # 打开 Roles 视图,给任意 role 重选模型
/model opus                      # 模糊匹配切当前模型
```


### 3.2 与 Ctrl+P 区别

| | Ctrl+P | `/model` |
| --- | -------- | --------- |
| 操作 | 在配置的模型间循环(默认 `smol → default → slow`) | 打开全 role 的 Roles 视图 |
| 范围 | 当前 role 的候选 | 任意 role |
| 速度 | 一键循环 | 即时 |

> `Ctrl+P`:像 alt-tab,在候选里转
> `/model`:像切换桌面,全角色重排

### 3.3 与 pi 对比

| | pi | omp |
| --- | ----- | ----- |
| 切模型 | `--model` / `/model` | ✅ 增强版,可指定 role |
| 切 role | n/a | ✅ `--smol` `--slow` `--plan` |

## 4. 三个 magic keywords (魔法关键字)

### 4.1 三个关键词

| 关键词 | 触发 | 作用 |
| -------- | ------ | ------ |
| `ultrathink` | turn (轮次) 首字 | 要模型开最高思考 |
| `orchestrate` | turn 首字 | 强制走并行 subagent + 验证 |
| `workflowz` | turn 首字 | 搭确定性多 subagent workflow |

### 4.2 关键属性

- **必须在 prose (自然语言段落) 里出现**
- **不会在 code span (代码片段) / fenced block (围栏代码块) / XML/HTML / identifier / path 里触发**

```text
[✓ 触发]
帮我 ultrathink 这段代码

[✗ 不触发]
let ultrathink = 1;       // 这是变量名
`ultrathink` in docs       // 这是 code
/ultrathink/path           // 这是 path
```

### 4.3 ultrathink

```text
[你]
ultrathink: 帮我设计这个 auth 模块

[agent]
进入 ultrathink 模式:
 - 开最高 supported automatic thinking effort
 - 把思考过程可见地展开
 - token 消耗 ↑,质量 ↑
```

### 4.4 orchestrate

```text
[你]
orchestrate 重构 src/

[agent]
强制走 fan-out (扇出派发) 流程:
 1. 把任务拆 N 块
 2. 并行 subagent (子代理)
 3. 每块 verify
 4. fan-in (扇入汇总)
```

vs `ultrathink`:ultrathink 是"想得深",orchestrate 是"做得多"。

### 4.5 workflowz

```text
[你]
workflowz: 帮我搭 CI 流水线

[agent]
进入 workflowz 模式:
 - 围绕 `eval` 内核的 agent() / parallel() / pipeline() / completion() 搭确定性 workflow(需 eval 和 task 同时激活)
 - 每步有 input/output schema
 - 跨步 barrier (同步屏障)
 - 跑完得可复用的 workflow 定义
```

vs `orchestrate`:orchestrate 是"这次这么干",workflowz 是"以后都这么干"。

### 4.6 三个关键词的关系

| 关键词 | 维度 | 适合 |
| -------- | ------ | ------ |
| `ultrathink` | 单 turn 深度 | 难问题、深推理 |
| `orchestrate` | 多 agent 并行 | 大重构 |
| `workflowz` | 复现性 workflow | CI / 反复跑的流程 |

### 4.7 与 pi 对比

| | pi | omp |
| --- | ----- | ----- |
| 思考深度触发 | ❌ | ✅ `ultrathink` |
| 强制并行 | ❌ | ✅ `orchestrate` |
| 复现 workflow | ❌ | ✅ `workflowz` |
| 语法边界 | n/a | ✅ 不在代码里误触发 |

## 5. 三个 slash 命令汇总

| 命令 | 作用 |
| ------ | ------ |
| `/vibe` | 只读 director 模式 |
| `/fresh` | 重置 provider 流状态 |
| `/model` | 切模型 / 切 role |

| 关键词 | 作用 |
| -------- | ------ |
| `ultrathink` | 高深度思考 |
| `orchestrate` | 并行 subagent |
| `workflowz` | 复现 workflow |

## 6. 与 pi 的全景对比

| 维度 | pi | omp |
| ------ | ----- | ----- |
| Director 模式 | ❌ | ✅ `/vibe` |
| 流重置 | ❌ | ✅ `/fresh` |
| 跨 role 切模型 | ❌ | ✅ `/model --xxx` |
| Magic keywords | ❌ | ✅ 3 个 |
| 边界精确触发 | n/a | ✅ |

## ✅ 小结

| 武器 | 干什么 |
| ------ | -------- |
| `/vibe` | 你看过,worker 改 |
| `/fresh` | 重置流,保留 transcript |
| `/model` | 切模型 / 切 role |
| `ultrathink` | 想得深 |
| `orchestrate` | 并行做 |
| `workflowz` | 复现做 |

和 pi 的对照:**pi 没"会话级"控制,omp 把会话当成可编排的状态机**。

## 🎯 下一课预告:第十三课:browser + computer + 多模态

- browser:Puppeteer + CDP + Chrome relay extension
- computer:桌面控制(窗口/截图/AX tree/剪贴板)
- generate_image / inspect_image / tts
