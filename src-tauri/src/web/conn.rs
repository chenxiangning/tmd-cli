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
    // fs 域:只读面(读/搜/枚举/图像预览);写与逃逸面(打开/回收站/临时写)拒绝
    const FS_READ: &[&str] = &[
        "fs_collect_files",
        "fs_list_dir",
        "fs_read_file",
        "fs_read_head",
        "fs_read_tail",
        "fs_read_tail_changed",
        "fs_search",
        "fs_walk_files",
        "fs_walk_index",
        "read_binary_file_base64",
        "read_local_image_data_url",
    ];
    if FS_READ.contains(&cmd) {
        return true;
    }
    // git 域:只读面;写操作(stage/commit/push/分支/PR 触发)拒绝
    const GIT_READ: &[&str] = &[
        "git_status",
        "git_ignored_prefixes",
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
        "git_blame",
        "git_file_log",
    ];
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
/// session_spawn 额外收敛 spec.command ∈ 已知 CLI/shell 名(放行 spawn 不等于
/// 任意远程执行;手机 UI 只能从内置引擎表选择,自由 command 在域闸打回)。
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
        if cmd == "session_spawn" && !spawn_command_allowed(&raw) {
            return Err("app 设备仅可发起已知 CLI 引擎的会话".into());
        }
    }
    dispatch::dispatch(app, cmd, raw).await
}

/// 已知引擎/shell 名(spec.command 的 basename;桌面 cli-* 插件声明的启动命令)。
fn spawn_command_allowed(raw: &serde_json::Value) -> bool {
    const ENGINES: &[&str] = &[
        "omp", "pi", "claude", "codex", "kimi", "grok", "qoder", "opencode", "deepseek", "dsh",
        "bash", "zsh", "sh", "fish",
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
mod tests {
    use super::*;

    #[test]
    fn 会话域_放行轻交互与发起_拒绝杀与改属() {
        for ok in [
            "session_list",
            "session_disk_tail",
            "session_history_page",
            "session_link_log",
            "session_log_size",
            "session_write",
            "session_resize",
            "session_spawn",      // M2:手机可发起会话(大仙拍板:远程操作含发起)
            "session_pin_toggle", // 置顶窄写令(服务端读改写仅 sessionPins 一键)
        ] {
            assert!(app_allowed(ok), "{ok} 应允许");
        }
        /* bind_cli = 桌面镜像回写专用(webview 通道);设备域放行 = 张冠李戴任意身份 */
        for no in ["session_kill", "session_set_workspace", "session_bind_cli"] {
            assert!(!app_allowed(no), "{no} 应拒绝");
        }
    }

    #[test]
    fn spawn_命令收敛_引擎白名单() {
        let ok = |cmd: &str| serde_json::json!({ "profileId": "omp", "spec": { "command": cmd, "cwd": "/tmp" }, "workspaceId": null });
        assert!(spawn_command_allowed(&ok("omp")));
        assert!(spawn_command_allowed(&ok("/usr/local/bin/claude"))); // basename 命中
        assert!(spawn_command_allowed(&ok("zsh")));
        for bad in ["curl", "rm", "python3", "/bin/bash -c evil", ""] {
            assert!(!spawn_command_allowed(&ok(bad)), "{bad} 应拒绝");
        }
        // 缺 spec/command
        assert!(!spawn_command_allowed(&serde_json::json!({})));
    }

    #[test]
    fn fs_git_只读放行_写面拒绝() {
        assert!(app_allowed("fs_read_file"));
        assert!(app_allowed("git_status"));
        for no in [
            "fs_write_file",
            "fs_remove_path",
            "fs_trash_entry",
            "fs_open_with",
            "cli_install_run",
            "proc_communicate",
            "git_stage",
            "git_commit",
            "git_discard",
            "git_pull_push",
            "git_create_branch",
            "git_pr_run",
        ] {
            assert!(!app_allowed(no), "{no} 应拒绝");
        }
    }

    #[test]
    fn 配置只读_checkpoint只读_其余域全拒() {
        assert!(app_allowed("config_read_settings"));
        assert!(!app_allowed("config_write_settings"));
        assert!(!app_allowed("config_write_workspaces"));
        // quota_fetch = 桌面出站任意 HTTP 原语,SSRF 面,设备域不授
        assert!(!app_allowed("quota_fetch"));
        assert!(!app_allowed("quota_env_value"));
        // M2 审批线摘要:checkpoint 只读二令放行,写/回退全拒
        assert!(app_allowed("checkpoint_list"));
        assert!(app_allowed("checkpoint_batch_diff"));
        for no in [
            "checkpoint_anchor",
            "checkpoint_apply",
            "checkpoint_seal",
            "checkpoint_restore",
            "checkpoint_approve",
            "sqlite_query",
            "sqlite_execute",
            "wsl_exec",
            "lsp_send",
            "plugin_scan",
            "web_access_start",
            "web_relay_start",
            "ssh_connect",
            "totally_unknown_cmd",
        ] {
            assert!(!app_allowed(no), "{no} 应拒绝");
        }
    }
}
