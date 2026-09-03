# 第十三课 · 用户视角 · Browser + Computer + 多模态

> 配套主课:[13-multimodal-desktop.md](./../13-multimodal-desktop.md)
> 这一课解决:**让 agent 抓数据 / 操作桌面 / 看图 / 出图 / 出音频**。
> 用户视角:browser / computer / generate_image / inspect_image / tts。

---

## 场景 1 — `browser` 抓数据:headless 模式

**目的**:抓公开网页的列表数据,不弹出浏览器窗口。

```text
你:抓 https://example.com/products 上 .item 元素,列前 30 个。

agent:browser { action: "navigate", url: "https://example.com/products" }
agent:browser { action: "extract",  selector: ".item" }

agent:
  1. "Product A  -  $39.99"
  2. "Product B  -  $29.99"
  ...
  30. "Product Z -  $59.99"

agent:导出 → CSV / JSON / 直接 continue。
```

**期望**:

- 浏览器在你背后跑,不影响你看屏幕;
- stealth (反爬隐身) 默认开 —— 普通反爬检测过不去的概率小;
- 抓完自动存到缓存,后续 `extract` 同结构页面复用。

**踩坑提醒**:

- 真正反爬强的网站(SOX 网、登录墙后)stealth 可能不够;
- 不抢你的 Chrome:见场景 2。

---

## 场景 2 — `browser` 用你已有的 Chrome:relay 模式

**目的**:你 Chrome 已经开着 5 个标签,登录态 / cookies 都在,不要 agent 再起一个。

```text
你:看一下我开着的 salesforce tab,把它里面的 deal 列一下。

agent:browser {
  mode: "relay",        # 走 Chrome relay extension,共用你浏览器
  selector: ".deal-row"
}

agent:看到你 Chrome 第 4 个标签里的 deals:
       1. Acme Co. - $12000 - "Negotiation"
       2. ...
```

**前提**:

- 装 Chrome relay extension(社区维护,装一次就好);
- 你浏览器开着,不打架。

**踩坑提醒**:`relay` 不能批量开多个 tab,只在你已有 tab 上操作。

---

## 场景 3 — `browser` 操作 Slack

```text
你:帮我给 #general 发一条 "release shipped, smoke passed"。

agent:browser { action: "navigate", url: "https://app.slack.com/client/..." }
agent:browser { action: "click",      selector: "#general" }
agent:browser { action: "type",       selector: ".ql-editor", text: "release shipped, smoke passed" }
agent:browser { action: "press",      key: "Enter" }

agent:已发。
```

**期望**:

- 模拟人点点点,跟普通 RPA (Robotic Process Automation,机器人流程自动化) 一样;
- 登录态用 relay 模式保住;
- 抓取 → 编辑 → 提交一套动作。

---

## 场景 4 — `computer` 桌面控制:截图 + 视觉模型

**目的**:agent 直接看你屏幕,Vision 模型判断,然后动手。

```text
你:看一下我的桌面,告诉我现在屏幕上开着哪些 app。

agent:computer { action: "captureScreen" }
agent:inspect_image { file: "<screenshot>" }

agent:
  - Chrome (3 个标签可见)
  - Slack (已登录)
  - VSCode (打开 src/auth/login.ts)
  - Terminal (跑 npm test)
```

**期望**:

- 截图直接送视觉模型理解,不是 OCR 字符串;
- 5 秒级响应(本地 capture + 模型)。

---

## 场景 5 — `computer` 跨 app 自动化

```text
你:把刚抓到 Chrome 里的某段 quotes 拷到 Slack #data-team。

agent:computer { action: "copySelection", window: "Chrome" }
agent:computer { action: "switchTo",     window: "Slack" }
agent:computer { action: "paste",        target: "#data-team input" }
agent:computer { action: "press",        key: "Enter" }

agent:已贴并发送。
```

**持久 JS 通道**(让 agent 能持续操作):

```text
agent:computer {
  session: "persistent",
  alias: "my-mac"
}

agent:以后可以直接:
  - computer { session: "my-mac", action: "type", text: "..." }
  - 不必每次 capture 一次
```

---

## 场景 6 — `computer` UI 测试

```text
你:测一下 MyApp 的登录流程。

agent:computer { action: "navigate", to: "MyApp" }
agent:computer { action: "click",    selector: "Sign In" }
agent:computer { action: "type",     text: "user@example.com" }
agent:computer { action: "click",    selector: "Next" }
agent:computer { action: "type",     text: "supersecret" }
agent:computer { action: "click",    selector: "Submit" }
agent:computer { action: "screenshot" }
agent:inspect_image { file: "<screenshot>" }

agent:登录成功,截图存档。
```

**期望**:

- UI 自动化测试,可比对截图前后;
- 配合 DAP / browser,你能测桌面 + Web 混合应用。

---

## 场景 7 — `generate_image`:出图

```text
你:画一张 "calm ocean at sunrise" 的 hero 图,4K。

agent:generate_image {
  prompt: "calm ocean at sunrise, photography",
  size: "3840x2160",
  model: "openai/gpt-image-1"     # 也可 gemini / xai-grok-image
}

agent:已生成 → ~/Downloads/ocean.png
```

**期望**:

- 默认走 OpenAI gpt-image-1(好);
- 也可选 gemini / xai-grok-image;
- "生成图 → 写 README" 串联 OK(agent 自己)。

---

## 场景 8 — `inspect_image`:看图理解

```text
你:看一下 ~/Downloads/design.png 这个设计稿,跟现在的登陆页 diff 是?

agent:inspect_image { file: "~/Downloads/design.png" }

agent:设计稿 vs 现实的 diff:
       - Logo 位置: 设计稿居中,现实偏左 12px
       - 主标题字号: 设计 64px,现实 48px
       - CTA 按钮色: 设计 #2563eb,现实 #1d4ed8
       - ...
```

**期望**:

- 一眼看图,不是 OCR;
- 可以把 diff 推成"修一批 hashline 改动"给 ast_edit。

---

## 场景 9 — `tts`:文字转音频

```text
你:把这份 release notes 念出来,生成一段 30s 音频。

agent:tts {
  text: "<release notes 内容>",
  voice: "alloy",                # 或其他声音
  duration: "30s",
  format: "mp3"
}

agent:已生成 → ~/Downloads/release-notes.mp3
```

---

## 场景 10 — 设置门控:防止自动桌面控制

```yaml
# ~/.omp/agent/config.yml
multimodal:
  browser:
    enabled: true
    defaultMode: headless         # headless / headful / relay
    stealth: true
  computer:
    enabled: true                 # 默认关更安全
    requireExplicitStart: true    # 必须你手动 /computer start 才开
    sessionTtl: "30m"
    confirmations:
      destructive: true           # 删文件 / 关闭窗口需确认
  generateImage:
    enabled: true
    defaultModel: "openai/gpt-image-1"
  inspectImage:
    enabled: true
  tts:
    enabled: true
```

**期望**:

- `computer` 默认更保守,避免误操作;
- `destructive: true` 让删除/关闭窗口都要 ack。

---

## ✅ 这一课你该会的事

1. `browser { mode: headless }` 抓数据,不弹窗。
2. `browser { mode: relay }` 共用你自己的 Chrome,保住登录态。
3. `computer` 截图 → `inspect_image` 理解。
4. `computer` 跨 app 拷贝粘贴,持久 session 用 alias。
5. `generate_image` / `inspect_image` / `tts` 多模态三件套。
6. `multimodal.computer.requireExplicitStart` 让桌面操作保守默认。

---

## 🎯 下一课 →

[14-final-comparison.md](./14-final-comparison.md):21 块电池全景 + omp vs pi 终极对比表 + 5 分钟/一周/一个月三档实操清单。
