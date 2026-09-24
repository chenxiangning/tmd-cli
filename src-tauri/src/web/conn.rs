//! 连接身份与 AppDevice 命令域:scope 定义、域闸与 scoped dispatch 入口。
//! 浏览器(URL token)= 全量命令零回退;已配对设备(spec §B 轻交互域)按白名单裁剪。

use tauri::AppHandle;

use super::dispatch;

/// 连接身份。
#[derive(Clone)]
pub(crate) enum ConnScope {
    Browser,
    AppDevice { device_id: String },
}

impl ConnScope {
    /// hello capabilities 声明(协议治理:壳按需评估,不满足即 block 屏)。
    pub(crate) fn capability(&self) -> &'static str {
        match self {
            Self::Browser => "browser",
            Self::AppDevice { .. } => "app-device",
        }
    }
}

/// fs/git 只读白名单(模块级 = 测试可枚举;纪律:每项必有桥臂,交叉测试
/// conn_tests::白名单fs_git命令必有桥臂 用 include_str! 钉死漂移)。
pub(crate) const FS_READ: &[&str] = &[
    "fs_collect_files",
    "fs_list_dir",
    "fs_read_file",
    "fs_read_head",
    "fs_read_tail",
    "fs_read_tail_changed",
    "fs_search",
    "fs_walk_files",
    "read_binary_file_base64",
];
pub(crate) const GIT_READ: &[&str] = &[
    "git_status",
    "git_repos_scan",
    "git_ahead_behind",
    "git_diff_file_patch",
    "git_totals",
    "git_log",
    "git_commit_files",
    "git_commit_message",
    "git_branches",
    "git_branch_compare",
    "git_branch_worktree_files",
    "git_branch_worktree_patch",
    "git_remotes",
];

/// AppDevice 允许域(M2 起:轻交互 + 发起会话;spec §B,大仙 2026-09-22 拍板
/// 「手机的核心能力 = 远程连上桌面并操作桌面」,发起会话是操作的一部分)。
/// 白名单制,默认拒绝。
pub(crate) fn app_allowed(cmd: &str) -> bool {
    // 会话域:列表/回放/活流/发送/审批应答/终端自适应/发起会话(session_spawn;
    // 参数由桌面侧收敛为 工作区+引擎,桌面自己执行 CLI)/置顶窄写令;不杀会话。
    // bind_cli 不列:唯一调用方 = 桌面 bindIdentity 镜像回写(webview IPC 通道,不过
    // 本域闸),手机从不主动绑身份(桥 spawn 直填);放行 = 手机可把任意会话张冠李戴
    // 到任意磁盘身份(标题/归档/置顶 key 全被误导)。
    if let Some(rest) = cmd.strip_prefix("session_") {
        return matches!(
            rest,
            "list"
                | "disk_tail"
                | "history_page"
                | "link_log"
                | "log_size"
                | "size"
                | "write"
                | "resize"
                | "spawn"
                | "pin_toggle"
        );
    }
    // fs 域:只读面(表在模块级 FS_READ)。
    if FS_READ.contains(&cmd) {
        return true;
    }
    // git 域:只读面;写操作拒绝。
    if GIT_READ.contains(&cmd) {
        return true;
    }
    // 配置/环境域:只读;config_write_* 与其余域(sqlite/wsl/lsp/plugins/ssh/cli
    // 执行面/web 管理面)全部默认拒绝。
    // 注:quota_fetch 不进 AppDevice —— 它是桌面出站的任意 HTTP 原语(任意 url+方法),
    // 对设备通道即 SSRF 面;引擎版本 pill 在远程态降级(M1 取舍)。
    // checkpoint 只放摘要二令(M2 审批线只读);anchor/apply/seal/restore/approve 写全拒。
    matches!(
        cmd,
        "config_read_settings"
            | "config_read_workspaces"
            | "config_default_workspace_root"
            | "config_home_dir"
            | "config_dir"
            | "platform_kind"
            | "checkpoint_list"
            | "checkpoint_batch_diff"
    )
}

/// scoped dispatch:AppDevice 先过域闸(显式报错,前端可提示),浏览器直通。
/// session_spawn 额外收敛:spec.command ∈ 已知引擎名 + spec.env 剥离(防 PATH/DYLD
/// 注入劫持子进程)+ spec.cwd 限已注册工作区根(红队链4①;桌面自发不过本闸)。
/// config_read_settings 在设备域剥密钥字段(红队链2:整树裸回 = webRelayKey 泄露
/// → 中继 agent 劫持;手机只消费三覆盖层,剥键零成本)。
pub(crate) async fn dispatch_scoped(
    app: &AppHandle,
    scope: &ConnScope,
    cmd: &str,
    raw: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if let ConnScope::AppDevice { .. } = scope {
        if !app_allowed(cmd) {
            return Err(format!("app 设备命令不在允许域: {cmd}"));
        }
        if cmd == "session_spawn" {
            let mut raw = raw;
            if !spawn_command_allowed(&raw) {
                return Err("app 设备仅可发起已知 CLI 引擎的会话".into());
            }
            if !spawn_cwd_allowed(&raw) {
                return Err("app 设备仅可在已注册工作区内发起会话".into());
            }
            if let Some(sp) = raw.get_mut("spec").and_then(|s| s.as_object_mut()) {
                sp.insert("env".into(), serde_json::json!({}));
            }
            return dispatch::dispatch(app, cmd, raw).await;
        }
        if cmd == "config_read_settings" {
            let mut v = dispatch::dispatch(app, cmd, raw).await?;
            if let Some(o) = v.as_object_mut() {
                o.retain(|k, _| !settings_secret(k));
            }
            return Ok(v);
        }
    }
    dispatch::dispatch(app, cmd, raw).await
}

/// 设备面 settings 剥键规则:中继密钥/桥 token 类字段不出桥(命名含 key/token/
/// secret/password 一刀切 + webRelayUrl 显式项;手机只消费三覆盖层,剥键零成本)。
fn settings_secret(key: &str) -> bool {
    let k = key.to_ascii_lowercase();
    k == "webrelayurl"
        || k.contains("key")
        || k.contains("token")
        || k.contains("secret")
        || k.contains("password")
}

/// 设备域事件订阅白名单(红队链3:命令域闸的事件面镜像)。pty:// = 会话实况/退出
/// (设备可看用户全部会话 = 「批准设备=SSH 级信任」模型内,session_disk_tail 同理);
/// settings:changed = 覆盖层同步。ssh:// / lsp:// / web://pair-alert / plugin 域全拒。
pub(crate) fn event_allowed(event: &str) -> bool {
    event.starts_with("pty://") || event == "settings:changed"
}

/// spawn cwd 必须落在已注册工作区根(或默认工作区)内;canonicalize 双侧防 symlink/`..` 逃逸。
fn spawn_cwd_allowed(raw: &serde_json::Value) -> bool {
    let Some(cwd) = raw
        .get("spec")
        .and_then(|s| s.get("cwd"))
        .and_then(|c| c.as_str())
    else {
        return false;
    };
    let Ok(target) = std::path::Path::new(cwd).canonicalize() else {
        return false;
    };
    let ws = crate::session::load_workspaces();
    let default_root = crate::session::default_workspace_root().canonicalize().ok();
    ws.list.iter().any(|w| {
        std::path::Path::new(&w.root)
            .canonicalize()
            .map(|r| target.starts_with(&r))
            .unwrap_or(false)
            || default_root
                .as_ref()
                .map(|d| target.starts_with(d))
                .unwrap_or(false)
    })
}

/// 已知引擎名(spec.command 的 basename;桌面 cli-* 插件声明的启动命令)。
/// qoder 的权威命令是 qodercli(cli-qoder/index.tsx:17);deepseek 无桌面 profile,死项删。
/// shell 四件套(bash/zsh/sh/fish)不列(2026-09-24 专业收口):手机引擎表无 shell 入口,
/// 桌面内置终端走 webview IPC 不过本闸 —— 留着 = 批准设备可起交互 shell 的纯攻击面。
fn spawn_command_allowed(raw: &serde_json::Value) -> bool {
    const ENGINES: &[&str] = &[
        "omp",
        "pi",
        "claude",
        "codex",
        "kimi",
        "grok",
        "qodercli",
        "qoderclicn",
        "opencode",
        "dsh",
    ];
    let cmd = raw
        .get("spec")
        .and_then(|s| s.get("command"))
        .and_then(|c| c.as_str())
        .unwrap_or("");
    let base = cmd.rsplit('/').next().unwrap_or("");
    ENGINES.contains(&base)
}

// ---------- 活跃设备连接登记(撤销即时踢,不等 5s 复查) ----------

static ACTIVE: std::sync::LazyLock<
    parking_lot::Mutex<std::collections::HashMap<String, Vec<tokio::sync::watch::Sender<()>>>>,
> = std::sync::LazyLock::new(|| parking_lot::Mutex::new(std::collections::HashMap::new()));

/// 设备连接存活期登记(WS accept 后调用);Drop 自 dereg。
pub(crate) fn register_live(device_id: &str) -> (LiveGuard, tokio::sync::watch::Receiver<()>) {
    let (tx, rx) = tokio::sync::watch::channel(());
    ACTIVE
        .lock()
        .entry(device_id.to_string())
        .or_default()
        .push(tx);
    (
        LiveGuard {
            device_id: device_id.to_string(),
        },
        rx,
    )
}

/// 存活登记 RAII:连接结束自动摘除(顺带清已关闭的 sender)。
pub(crate) struct LiveGuard {
    device_id: String,
}

impl Drop for LiveGuard {
    fn drop(&mut self) {
        let mut map = ACTIVE.lock();
        if let Some(list) = map.get_mut(&self.device_id) {
            list.retain(|tx| !tx.is_closed());
            if list.is_empty() {
                map.remove(&self.device_id);
            }
        }
    }
}

/// 踢某设备的全部活跃连接(撤销/删除设备行时调用);本文件仅此一处写 ACTIVE。
pub(crate) fn kick(device_id: &str) {
    if let Some(list) = ACTIVE.lock().get(device_id) {
        for tx in list {
            let _ = tx.send(());
        }
    }
}

/// 设备当前是否有活连接(设备卡「已连接/离线」徽标)。
pub(crate) fn is_online(device_id: &str) -> bool {
    ACTIVE
        .lock()
        .get(device_id)
        .is_some_and(|list| !list.is_empty())
}

#[cfg(test)]
// 测试体按 300 行铁则外提(path 子模块:super::* 私有项仍可见)。
#[path = "conn_tests.rs"]
mod tests;
