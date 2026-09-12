//! wsl 会话存储真机诊断 —— 自主文件(与 wsl_remote_tests 同款 env 纪律,凭据不入仓)。
//! TMD_WSL_PROBE_HOST/USER/PASS [TMD_WSL_PROBE_DISTRO/CWD] \
//!   cargo test wsl_session_store -- --ignored --nocapture

use super::{
    authenticate_ssh_handle, connect_trusting, exec_collect, resolve_ssh_auth_material,
    SshAuthOutcome, SshHostWire,
};

/// 真机 live 会话存储诊断(ignored,env 同上):验收「点历史行列表变多」用 ——
/// 直接列发行版内 omp/pi 会话存储的目录与文件(名字含创建时刻前缀,mtime 看
/// resume 是续写还是分叉新文件),一并回显远程扫描脚本(list/readStatus)的
/// 真实行输出,核对解析层假设。
#[test]
#[ignore = "需要真机凭据(env),默认跳过"]
fn wsl_remote_live_session_store_diag() {
    let wire = SshHostWire {
        name: "live-store".into(),
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
    let cwd = std::env::var("TMD_WSL_PROBE_CWD").unwrap_or_else(|_| "~".into());
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        let mut handle = connect_trusting(&wire).await.expect("连接");
        match authenticate_ssh_handle(&mut handle, &wire, resolve_ssh_auth_material(&wire).unwrap())
            .await
            .unwrap()
        {
            SshAuthOutcome::Authenticated => {}
            SshAuthOutcome::KeyboardInteractivePrompt(_) => panic!("诊断路径不支持 KBI"),
        }
        /* omp slug 规则的 shell 形态(与 cli-omp remoteSessionsDirSh 同源,含 ~ 归一) */
        let script = format!(
            r#"h=$HOME
c='{cwd}'
case "$c" in "~"|"~"/*) c="$h${{c#"~"}}" ;; esac
case "$c" in "$h") d="$h/.omp/agent/sessions" ;;
"$h"/*) d="$h/.omp/agent/sessions/$(printf "%s" "${{c#"$h"}}" | tr / -)" ;;
*) d="$h/.omp/agent/sessions/-$(printf "%s" "$c" | tr / -)-" ;;
esac
echo "SLUG_DIR=$d"
[ -d "$d" ] || echo "(目录不存在)"
ls -1t "$d" 2>/dev/null | head -10 | while IFS= read -r f; do
  echo "   $f  $(stat -c %y "$d/$f" 2>/dev/null | cut -c1-19)"
done
echo "== 全存储最近 10 个文件 =="
find "$h/.omp/agent/sessions" -name '*.jsonl' -newermt '2026-09-11' 2>/dev/null | while IFS= read -r f; do
  echo "   $f  $(stat -c %y "$f" | cut -c1-19)"
done
"#,
            cwd = cwd
        );
        let payload = crate::wsl_remote_ops::wsl_bash_payload(&distro, &script);
        let (text, code) = exec_collect(&mut handle, &payload).await.expect("存储诊断");
        println!("== 会话存储诊断(code={code:?}) ==\n{text}");
    });
}
