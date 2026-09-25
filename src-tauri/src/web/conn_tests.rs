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

/// 三表漂移防线:白名单放行的 session/checkpoint 命令必须都在桥闸表(GATED)。
/// 2026-09-24 实证:加令时 session_link_log 被顶出闸表 → 桥面 unknown command。
#[test]
fn 白名单会话命令必在桥闸表() {
    for cmd in "session_list session_disk_tail session_history_page session_link_log \
            session_log_size session_size session_write session_resize session_spawn \
            session_pin_toggle checkpoint_list checkpoint_batch_diff"
        .split(' ')
    {
        assert!(
            super::super::dispatch_session::GATED.contains(&cmd),
            "{cmd} 缺桥闸表臂"
        );
    }
}

/// 白名单 fs/git 项必有桥臂(include_str! 扫臂表源;2026-09-24 清 5 死放行后钉死)。
#[test]
fn 白名单fs_git命令必有桥臂() {
    const FS: &str = include_str!("dispatch_fs.rs");
    const GIT: &str = include_str!("dispatch_git.rs");
    const GITB: &str = include_str!("dispatch_git_branch.rs");
    for cmd in FS_READ {
        assert!(FS.contains(&format!("\"{cmd}\"")), "{cmd} 缺 fs 桥臂");
    }
    for cmd in GIT_READ {
        assert!(
            GIT.contains(&format!("\"{cmd}\"")) || GITB.contains(&format!("\"{cmd}\"")),
            "{cmd} 缺 git 桥臂"
        );
    }
}

#[test]
fn spawn_命令收敛_引擎白名单() {
    let ok = |cmd: &str| serde_json::json!({ "profileId": "omp", "spec": { "command": cmd, "cwd": "/tmp" }, "workspaceId": null });
    assert!(spawn_command_allowed(&ok("omp")));
    assert!(!spawn_command_allowed(&ok("/usr/local/bin/claude"))); // 路径形:PTY 原样透传,basename 命中 = 闸洞
    assert!(!spawn_command_allowed(&ok("./claude"))); // 工作区内同名可执行 = 任意执行
    for bad in [
        "curl",
        "rm",
        "python3",
        "bash",
        "zsh",
        "sh",
        "fish",
        "/bin/bash -c evil",
        "",
    ] {
        assert!(!spawn_command_allowed(&ok(bad)), "{bad} 应拒绝");
    }
    // 缺 spec/command
    assert!(!spawn_command_allowed(&serde_json::json!({})));
}

#[test]
fn fs_git_只读放行_写面拒绝() {
    assert!(app_allowed("fs_read_file"));
    assert!(app_allowed("git_status"));
    // 手机 git 面板动作(大仙 2026-09-24 复刻桌面操作菜单):远端操作/切分支/PR
    // 对批准设备放行(SSH 级信任,与 session_spawn 同律)。
    assert!(app_allowed("git_pull_push"));
    assert!(app_allowed("git_checkout"));
    assert!(app_allowed("git_pr_defaults"));
    assert!(app_allowed("git_pr_run"));
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
        "git_create_branch",
    ] {
        assert!(!app_allowed(no), "{no} 应拒绝");
    }
}

#[test]
fn 配置只读_checkpoint只读_其余域全拒() {
    assert!(app_allowed("config_read_settings"));
    assert!(!app_allowed("config_merge_settings"));
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

#[test]
fn 设备域事件订阅闸_会话流放行其余全拒() {
    for ok in ["pty://out/s1", "pty://exit/s1", "settings:changed"] {
        assert!(event_allowed(ok), "{ok} 应放行");
    }
    // 红队链3:这些事件旁路命令域闸(SSH 操作流/编辑器代码/告警 IP/管理面)
    for no in [
        "ssh://event/s1",
        "ssh://prompt/s1",
        "lsp://message",
        "web://pair-alert",
        "web://devices",
        "cli-install://x",
    ] {
        assert!(!event_allowed(no), "{no} 应拒");
    }
}

#[test]
fn 设备面settings剥键_覆盖层留密钥去() {
    for keep in ["sessionTitles", "sessionArchive", "sessionPins", "theme"] {
        assert!(!settings_secret(keep), "{keep} 应保留");
    }
    for cut in [
        "webRelayKey",
        "webRelayUrl",
        "apiKey",
        "someToken",
        "dbSecret",
        "password",
    ] {
        assert!(settings_secret(cut), "{cut} 应剥");
    }
}

#[test]
fn spawn_引擎表含qodercli不含裸qoder() {
    let ok = |cmd: &str| serde_json::json!({ "spec": { "command": cmd } });
    assert!(spawn_command_allowed(&ok("qodercli"))); // 桌面权威命令(cli-qoder/index.tsx:17)
    assert!(!spawn_command_allowed(&ok("qoder"))); // 漂移名:不存在二进制,秒退
    assert!(!spawn_command_allowed(&ok("deepseek"))); // 无桌面 profile,死项
}

/// 手机引擎表(engines.ts)与桥闸对齐:手机表加新引擎而闸未加 = spawn 全拒,
/// 只有真机能发现(第二轮评审 TestQuality P2;include_str! 扫描同「桥臂表」先例)。
#[test]
fn 手机引擎表命令必过桥闸() {
    const TS: &str = include_str!("../../../src/mobile/engines.ts");
    let mut found = 0;
    let mut rest = TS;
    while let Some(at) = rest.find("cmd: \"") {
        let after = &rest[at + 6..];
        let end = after.find('"').expect("cmd 字符串未闭合");
        let cmd = &after[..end];
        assert!(
            spawn_command_allowed(&serde_json::json!({ "spec": { "command": cmd } })),
            "{cmd} 手机表有、桥闸拒绝"
        );
        found += 1;
        rest = &after[end..];
    }
    assert!(found >= 8, "引擎表扫描异常(仅 {found} 项)");
}
