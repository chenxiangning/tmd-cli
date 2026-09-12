//! wsl_remote 真机 live 测试 —— 自主文件(文件规模铁则:主文件保通道层)。
//! 全部 #[ignore]
//! 全部 #[ignore],凭据走 env 不入仓;局域网 Windows 宿主(OpenSSH + WSL)一台即可:
//! TMD_WSL_PROBE_HOST=… TMD_WSL_PROBE_USER=… TMD_WSL_PROBE_PASS=… \
//!   [TMD_WSL_PROBE_DISTRO=…] cargo test wsl_remote -- --ignored --nocapture

use super::*;

/// 行协议分隔符(扫描脚本 printf 的真实制表符)。
const TAB: char = '\t';

/// 真机 live 探针:发行版表 + b64 载荷引擎探针端到端(`bin:path` 行协议
/// 须在真机 PowerShell 全链保真;/mnt/* 互操作过滤见 wsl_remote_ops)。
#[test]
#[ignore = "需要真机凭据(env),默认跳过"]
fn wsl_remote_live() {
    let wire = SshHostWire {
        name: "live-probe".into(),
        host: std::env::var("TMD_WSL_PROBE_HOST").expect("TMD_WSL_PROBE_HOST"),
        port: 22,
        username: std::env::var("TMD_WSL_PROBE_USER").expect("TMD_WSL_PROBE_USER"),
        password: std::env::var("TMD_WSL_PROBE_PASS").expect("TMD_WSL_PROBE_PASS"),
        auth_type: "password".into(),
        private_key: String::new(),
        private_key_path: String::new(),
        private_key_passphrase: String::new(),
        proxy: None,
    };
    let info = tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(probe(&wire))
        .expect("探测应成功");
    println!("probe = {info:?}");
    assert!(info.available, "宿主应有可用 WSL");
    let running = info
        .distros
        .iter()
        .find(|d| d.running)
        .expect("至少一个运行中发行版");
    let probes = tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(crate::wsl_remote_ops::wsl_probe_engines(
            running.name.clone(),
            vec![
                "claude".into(),
                "omp".into(),
                "definitely-missing-bin".into(),
            ],
            Some(wire.clone()),
        ))
        .expect("引擎探针应成功");
    println!("probes = {probes:?}");
    /* Windows 侧经互操作检出的安装(/mnt 前缀)应记未检出;claude 装在发行版内
    (/usr/local/bin)不受过滤影响。 */
    assert!(
        probes.iter().any(|p| p.bin == "claude" && p.path.is_some()),
        "claude 应检出;probes = {probes:?}"
    );
    assert!(
        probes
            .iter()
            .any(|p| p.bin == "definitely-missing-bin" && p.path.is_none()),
        "缺失 binary 应报未检出"
    );
    /* omp 装在 ~/.local/bin(登录 PATH):非登录 shell 探不到即本修复的回归。 */
    assert!(
        probes.iter().any(|p| p.bin == "omp"
            && p.path
                .as_deref()
                .is_some_and(|x| x.contains("/.local/bin/"))),
        "~/.local/bin 的 omp 应经登录 PATH 检出;probes = {probes:?}"
    );

    /* 远程脚本执行通道(来源 remoteExec 协议的传输层)。 */
    let exec_out = tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(crate::wsl_remote_ops::wsl_exec(
            running.name.clone(),
            "printf wsl_exec_OK".into(),
            Some(wire.clone()),
        ))
        .expect("wsl_exec 应成功");
    assert_eq!(exec_out, "wsl_exec_OK");

    /* pi 族远程扫描脚本全链(目录发现 + 制表符行协议 + base64 头):引擎侧
    remoteSessions.list 生成的就是这段脚本形态,此处实证真机可跑出数据行。 */
    let scan = tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(crate::wsl_remote_ops::wsl_exec(
            running.name.clone(),
            r#"d="$HOME/.pi/agent/sessions/--home-cxn-.ssh--"
for f in "$d"/*.jsonl; do
  [ -e "$f" ] || continue
  printf '%s	%s	' "$(basename "$f" .jsonl)" "$(stat -c %Y "$f")"
  head -c 32768 "$f" | base64 -w0
  printf '
'
done"#
                .into(),
            Some(wire.clone()),
        ))
        .expect("远程扫描应成功");
    let diag = tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(crate::wsl_remote_ops::wsl_exec(
            running.name.clone(),
            r#"find "$HOME" -maxdepth 8 -name "*.jsonl" -mtime -2 2>/dev/null | grep -v node_modules | head -8
echo ---
find "$HOME/.local/share" -maxdepth 4 -type d 2>/dev/null | grep -i -E "pi|session" | head -6"#
                .into(),
            Some(wire.clone()),
        ))
        .unwrap_or_default();
    println!("pi_diag =\n{diag}");
    assert!(
        scan.lines().any(|l| l.contains(TAB) && l.len() > 60),
        "扫描应产出 制表符行协议 的会话行(name{TAB}mtime{TAB}head-b64);scan = {scan:?}"
    );

    /* 文件文本读取端到端(size 行 + b64 段全链;/etc/hostname 小而必有)。 */
    let file = tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(crate::wsl_remote_ops::wsl_read_file_text(
            running.name.clone(),
            "/etc/hostname".into(),
            512 * 1024,
            Some(wire),
        ))
        .expect("远程文件读取应成功");
    println!("file = {file:?}");
    assert!(file.size > 0, "/etc/hostname 应非空");
    assert!(
        file.content.as_deref().is_some_and(|c| !c.is_empty()),
        "内容段应解出非空文本"
    );
}

/// 真机 live PTY 会话诊断:远程 WSL 会话白屏根因实证 —— 开 PTY exec wsl.exe
/// 后静默读 6s(启动链只发 `\x1b[6n` 就死等),手工补一条 CPR 应答(\x1b[1;1R)
/// 再读 4s,应出提示符(2026-09-11 实证:PHASE1 仅 6n,PHASE2 全提示符)。
#[test]
#[ignore = "需要真机凭据(env),默认跳过"]
fn wsl_remote_live_pty_diag() {
    let wire = SshHostWire {
        name: "live-pty".into(),
        host: std::env::var("TMD_WSL_PROBE_HOST").expect("TMD_WSL_PROBE_HOST"),
        port: 22,
        username: std::env::var("TMD_WSL_PROBE_USER").expect("TMD_WSL_PROBE_USER"),
        password: std::env::var("TMD_WSL_PROBE_PASS").expect("TMD_WSL_PROBE_PASS"),
        auth_type: "password".into(),
        private_key: String::new(),
        private_key_path: String::new(),
        private_key_passphrase: String::new(),
        proxy: None,
    };
    let distro = format!(
        "wsl.exe -d \"{}\"",
        std::env::var("TMD_WSL_PROBE_DISTRO").unwrap_or_else(|_| "Ubuntu".into())
    );
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        let mut handle = connect_trusting(&wire).await.expect("连接");
        match authenticate_ssh_handle(
            &mut handle,
            &wire,
            resolve_ssh_auth_material(&wire).unwrap(),
        )
        .await
        .unwrap()
        {
            SshAuthOutcome::Authenticated => {}
            SshAuthOutcome::KeyboardInteractivePrompt(_) => panic!("诊断路径不支持 KBI"),
        }
        let channel = handle.channel_open_session().await.expect("通道");
        channel
            .request_pty(false, "xterm-256color", 120, 30, 0, 0, &[])
            .await
            .expect("PTY");
        channel.exec(false, distro.as_str()).await.expect("exec");
        let (mut reader, writer) = channel.split();
        let mut sink = writer.make_writer();
        use tokio::io::AsyncWriteExt;
        let mut phase1 = Vec::new();
        for _ in 0..8 {
            if let Ok(Some(russh::ChannelMsg::Data { data })) =
                tokio::time::timeout(std::time::Duration::from_millis(500), reader.wait()).await
            {
                phase1.extend_from_slice(&data);
            }
        }
        println!(
            "PHASE1(未应答 4s)= {:?}",
            String::from_utf8_lossy(&phase1)
                .escape_default()
                .to_string()
        );
        sink.write_all(b"\x1b[1;1R").await.expect("写 CPR 应答");
        let mut phase2 = Vec::new();
        for _ in 0..8 {
            if let Ok(Some(russh::ChannelMsg::Data { data })) =
                tokio::time::timeout(std::time::Duration::from_millis(500), reader.wait()).await
            {
                phase2.extend_from_slice(&data);
            }
        }
        println!(
            "PHASE2(应答后 4s)= {:?}",
            String::from_utf8_lossy(&phase2)
                .escape_default()
                .to_string()
        );
        assert!(!phase2.is_empty(), "补 CPR 应答后应有输出(提示符)");
    });
}

/// 真机 live CLI 会话诊断(ignored,env 同上;TMD_WSL_PROBE_ENGINE 缺省 claude):
/// 侧栏「新建 WSL CLI 会话」白屏第二轮实证 —— spawn 串是
/// `wsl.exe -d "D" --cd "~/.ssh" -- bash -lc '<engine>'`,与裸 shell 会话差在
/// 登录 shell。两段:① 无 PTY exec 查登录 shell 的 PATH 解析顺序(怀疑互操作
/// /mnt/c 抢占,`claude` 实际落 Windows 侧安装);② 真 PTY 跑同一 spawn 串,
/// 补 CPR 应答后看 TUI 是否画出(区分「应答被吞」与「引擎自身挂死」)。
#[test]
#[ignore = "需要真机凭据(env),默认跳过"]
fn wsl_remote_live_cli_diag() {
    let wire = SshHostWire {
        name: "live-cli".into(),
        host: std::env::var("TMD_WSL_PROBE_HOST").expect("TMD_WSL_PROBE_HOST"),
        port: 22,
        username: std::env::var("TMD_WSL_PROBE_USER").expect("TMD_WSL_PROBE_USER"),
        password: std::env::var("TMD_WSL_PROBE_PASS").expect("TMD_WSL_PROBE_PASS"),
        auth_type: "password".into(),
        private_key: String::new(),
        private_key_path: String::new(),
        private_key_passphrase: String::new(),
        proxy: None,
    };
    let distro = std::env::var("TMD_WSL_PROBE_DISTRO").unwrap_or_else(|_| "Ubuntu".into());
    let engine = std::env::var("TMD_WSL_PROBE_ENGINE").unwrap_or_else(|_| "claude".into());
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        /* ① 登录 shell 解析:command -v + PATH(无 PTY,纯 exec 管道) */
        let mut handle = connect_trusting(&wire).await.expect("连接");
        match authenticate_ssh_handle(&mut handle, &wire, resolve_ssh_auth_material(&wire).unwrap())
            .await
            .unwrap()
        {
            SshAuthOutcome::Authenticated => {}
            SshAuthOutcome::KeyboardInteractivePrompt(_) => panic!("诊断路径不支持 KBI"),
        }
        let probe_cmd = format!(
            "wsl.exe -d \"{distro}\" -- bash -lc 'echo RESOLVE=$(command -v {engine}); echo PATH=$PATH'",
        );
        let (text, code) = exec_collect(&mut handle, &probe_cmd).await.expect("① 登录解析");
        println!("① 登录 shell 解析(code={code:?})=\n{text}");

        /* ② 真 PTY 跑 spawn 串:6s 静默 → 补 CPR → 再读 10s */
        let spawn_cmd = format!("wsl.exe -d \"{distro}\" --cd \"~\" -- bash -lc '{engine}'");
        let channel = handle.channel_open_session().await.expect("通道");
        channel
            .request_pty(false, "xterm-256color", 120, 30, 0, 0, &[])
            .await
            .expect("PTY");
        channel.exec(false, spawn_cmd.as_str()).await.expect("exec");
        let (mut reader, writer) = channel.split();
        let mut sink = writer.make_writer();
        use tokio::io::AsyncWriteExt;
        let mut phase1 = Vec::new();
        for _ in 0..12 {
            if let Ok(Some(russh::ChannelMsg::Data { data })) =
                tokio::time::timeout(std::time::Duration::from_millis(500), reader.wait()).await
            {
                phase1.extend_from_slice(&data);
            }
        }
        println!(
            "② PTY PHASE1(未应答 6s)= {:?}",
            String::from_utf8_lossy(&phase1)
                .escape_default()
                .to_string()
        );
        sink.write_all(b"\x1b[1;1R").await.expect("写 CPR 应答");
        let mut phase2 = Vec::new();
        for _ in 0..20 {
            if let Ok(Some(russh::ChannelMsg::Data { data })) =
                tokio::time::timeout(std::time::Duration::from_millis(500), reader.wait()).await
            {
                phase2.extend_from_slice(&data);
            }
        }
        println!(
            "② PTY PHASE2(应答后 10s)= {:?}",
            String::from_utf8_lossy(&phase2)
                .escape_default()
                .to_string()
        );
        assert!(
            !phase2.is_empty(),
            "补 CPR 应答后引擎应有输出(TUI 首帧/启动日志)"
        );
    });
}
