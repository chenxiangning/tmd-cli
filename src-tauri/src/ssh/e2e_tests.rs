//! SSH 引擎端到端测试 —— 依赖本机 2222 端口的临时 sshd(见验证脚本),
//! #[ignore] 标注:CI 无该环境;本地显式 `cargo test -- --ignored` 运行。
//! 覆盖:known_hosts 首连信任流 → 私钥认证 → PTY shell 读写 → 会话收尾。

use super::*;
use std::time::Duration;

fn e2e_host() -> transport::SshHostWire {
    let home = crate::session::home_dir();
    transport::SshHostWire {
        name: "e2e".into(),
        host: "127.0.0.1".into(),
        port: 2222,
        username: whoami(),
        auth_type: "privateKey".into(),
        password: String::new(),
        private_key: String::new(),
        private_key_path: home.join(".ssh/id_ed25519").display().to_string(),
        private_key_passphrase: String::new(),
        proxy: None,
    }
}

fn whoami() -> String {
    std::env::var("USER").unwrap_or_else(|_| "root".into())
}

#[tokio::test]
#[ignore = "需要本机 2222 临时 sshd + ~/.ssh/id_ed25519 已授权"]
async fn ssh_engine_end_to_end() {
    let host = e2e_host();
    /* 隔离 known_hosts:e2e 前清掉本条信任,验证首连信任流。 */
    let _ = known_hosts::reset(&host.host, host.port);

    let captured = Arc::new(tokio::sync::Mutex::new(None::<transport::CapturedHostKey>));
    let first = transport::connect_ssh_handle(&host, Arc::clone(&captured)).await;
    let first_error = first.err().map(|e| e).unwrap_or_default();
    let host_key_needed = first_error.len() > 0 && captured.lock().await.is_some();
    assert!(
        host_key_needed,
        "首连应触发 host key 信任流(实得错误:{first_error})"
    );

    let key = captured
        .lock()
        .await
        .clone()
        .expect("captured host key")
        .key;
    known_hosts::trust(&key).expect("信任落库");
    /* 再连:known_hosts 放行,私钥认证成功。 */
    let mut handle = transport::connect_ssh_handle(&host, Arc::new(tokio::sync::Mutex::new(None)))
        .await
        .expect("信任后连接成功");
    let auth = auth::resolve_ssh_auth_material(&host).expect("认证材料");
    match auth::authenticate_ssh_handle(&mut handle, &host, auth).await.unwrap() {
        auth::SshAuthOutcome::Authenticated => {}
        auth::SshAuthOutcome::KeyboardInteractivePrompt(_) => {
            panic!("私钥认证应直接成功,不应进入 KBI")
        }
    }

    /* PTY shell:写命令,读输出(带超时轮询)。 */
    let channel = session::open_shell_channel_for_test(&handle, 80, 24)
        .await
        .expect("shell 通道");
    let (mut reader, writer) = channel.split();
    let mut sink = writer.make_writer();
    use tokio::io::AsyncWriteExt;
    sink.write_all(b"echo TMD_E2E_OK\n").await.expect("写入命令");
    /* 读取走 ChannelMsg::Data(IO 泵同款原语),2s 窗口内等回显标记。 */
    let mut seen = String::new();
    for _ in 0..16 {
        let message = tokio::time::timeout(Duration::from_millis(500), reader.wait())
            .await
            .unwrap_or(None);
        if let Some(russh::ChannelMsg::Data { data }) = message {
            seen.push_str(&String::from_utf8_lossy(data.as_ref()));
            if seen.contains("TMD_E2E_OK") {
                break;
            }
        }
    }
    assert!(seen.contains("TMD_E2E_OK"), "shell 输出应回显标记,实得:{seen}");

    /* SFTP 子系统:同连接开 channel,list + 写 + 读回(乐观并发携带 mtime/size)。 */
    {
        let registry = Arc::new(SshRegistry::default());
        let runtime = Arc::new(SshSessionRuntime::new());
        *runtime.status.lock() = STATUS_CONNECTED.to_string();
        /* SFTP 段独立建连(shell 段的 handle 已被通道消费)。 */
        let mut sftp_handle =
            transport::connect_ssh_handle(&host, Arc::new(tokio::sync::Mutex::new(None)))
                .await
                .expect("SFTP 段连接");
        if !matches!(
            auth::authenticate_ssh_handle(
                &mut sftp_handle,
                &host,
                auth::resolve_ssh_auth_material(&host).unwrap(),
            )
            .await
            .unwrap(),
            auth::SshAuthOutcome::Authenticated
        ) {
            panic!("SFTP 段认证意外进 KBI");
        }
        let _ = runtime.install_connection(sftp_handle, {
            let (tx, _rx) = tokio::sync::mpsc::channel(1);
            tx
        }, {
            let (tx, _rx) = tokio::sync::mpsc::channel(1);
            tx
        }).await;
        registry.sessions.lock().insert(
            "e2e".into(),
            Arc::new(SshSessionEntry {
                host: host.clone(),
                runtime,
                cols: std::sync::atomic::AtomicUsize::new(80),
                rows: std::sync::atomic::AtomicUsize::new(24),
                log_file: parking_lot::Mutex::new(None),
                log_path: None,
            }),
        );
        /* 测试只注入注册表(SFTP 路径无需 AppHandle,事件广播静默跳过)。 */
        attach_globals(None, &registry);

        let entries = sftp::list("e2e", Some("/tmp".into())).await.expect("SFTP list");
        assert!(entries.iter().any(|e| e.kind == "dir"), "/tmp 应含目录项");

        let target = "/tmp/tmd_sftp_e2e.txt";
        let outcome = sftp::write_text("e2e", target, "hello-ssh-plugin", None, None)
            .await
            .expect("SFTP 写入");
        let entry = match outcome {
            sftp::SftpWriteOutcome::Written { entry } => entry,
            sftp::SftpWriteOutcome::Conflict { .. } => panic!("全新文件不应冲突"),
        };
        let read = sftp::read_text("e2e", target, None, None).await.expect("SFTP 读回");
        assert_eq!(read.content, "hello-ssh-plugin");
        /* 乐观并发:携带过期 mtime 应报 conflict。 */
        let stale = sftp::write_text("e2e", target, "x", Some(entry.mtime - 999_999), None)
            .await
            .expect("写入调用本身成功");
        assert!(matches!(stale, sftp::SftpWriteOutcome::Conflict { .. }), "过期 mtime 应冲突");
        let _ = sftp::delete("e2e", target, false).await;
    }

    /* known_hosts 二连直接放行(无捕获)。 */
    let recapture = Arc::new(tokio::sync::Mutex::new(None::<transport::CapturedHostKey>));
    transport::connect_ssh_handle(&host, recapture)
        .await
        .expect("二连直接成功");
    let _ = known_hosts::reset(&host.host, host.port);
}
