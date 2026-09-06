//! SSH 认证材料 —— 私钥/密码材料解析、PEM 清洗、KBI 提示分类。
//! 自 auth.rs 拆出(文件规模铁则):认证主流程(authenticate_ssh_handle 等)留在 auth.rs。

use russh::client;
use russh::MethodKind;
use std::path::PathBuf;

use super::auth::{KeyboardInteractivePromptData, ResolvedSshAuth, SshPromptAnswerMode};
use super::transport::SshHostWire;

pub(crate) fn resolve_ssh_auth_material(host: &SshHostWire) -> Result<ResolvedSshAuth, String> {
    if host.auth_type == "keyboardInteractive" {
        Ok(ResolvedSshAuth::KeyboardInteractive)
    } else if host.auth_type == "privateKey" {
        let key = if !host.private_key.trim().is_empty() {
            host.private_key.trim().to_string()
        } else {
            let path = host.private_key_path.trim();
            if path.is_empty() {
                return Err("未配置 SSH 私钥".to_string());
            }
            let expanded = expand_ssh_private_key_path(path);
            std::fs::read_to_string(&expanded)
                .map_err(|error| format!("读取 SSH 私钥 {} 失败: {error}", expanded.display()))?
                .trim()
                .to_string()
        };
        let key = normalize_ssh_private_key_material(&key);
        if key.is_empty() {
            return Err("SSH 私钥内容为空".to_string());
        }
        let passphrase = host.private_key_passphrase.trim().to_string();
        Ok(ResolvedSshAuth::PrivateKey {
            key,
            passphrase: (!passphrase.is_empty()).then_some(passphrase),
        })
    } else {
        let password = host.password.trim().to_string();
        if password.is_empty() {
            return Err("未配置 SSH 密码".to_string());
        }
        Ok(ResolvedSshAuth::Password(password))
    }
}

/// 私钥材料清洗:粘贴残迹(BOM/零宽/CRLF/字面 \n/缩进/单行坍缩)
/// 修复后再交给 russh,否则 "看起来正常" 的 key 会以 Could not read key 失败。
pub(crate) fn normalize_ssh_private_key_material(raw: &str) -> String {
    let mut text = raw.to_string();
    for zero_width in ['\u{feff}', '\u{200b}', '\u{200c}', '\u{200d}'] {
        text = text.replace(zero_width, "");
    }
    text = text.replace('\u{a0}', " ");
    text = text
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace("\\r\\n", "\n")
        .replace("\\n", "\n")
        .replace("\\r", "\n");
    let joined = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    refold_pem_block(&joined).unwrap_or(joined)
}

/// 首个 PEM 块按规范 64 列重排;含 Proc-Type/DEK-Info 头的旧式加密 PEM 保持原样。
pub(crate) fn refold_pem_block(text: &str) -> Option<String> {
    const BEGIN: &str = "-----BEGIN ";
    const DASHES: &str = "-----";
    let begin_start = text.find(BEGIN)?;
    let after_begin = &text[begin_start + BEGIN.len()..];
    let label_end = after_begin.find(DASHES)?;
    let label = after_begin[..label_end].trim();
    if label.is_empty() {
        return None;
    }
    let body_start = begin_start + BEGIN.len() + label_end + DASHES.len();
    let end_marker = format!("-----END {label}-----");
    let end_rel = text[body_start..].find(&end_marker)?;
    let body_raw = &text[body_start..body_start + end_rel];
    if body_raw.contains(':') {
        return None;
    }
    let body: String = body_raw.chars().filter(|c| !c.is_whitespace()).collect();
    if body.is_empty() {
        return None;
    }
    let mut folded = format!("-----BEGIN {label}-----\n");
    for chunk in body.as_bytes().chunks(64) {
        folded.push_str(std::str::from_utf8(chunk).ok()?);
        folded.push('\n');
    }
    folded.push_str(&end_marker);
    Some(folded)
}

pub(crate) fn describe_private_key_decode_error(
    error: &russh::keys::Error,
    has_passphrase: bool,
) -> String {
    let text = error.to_string();
    if text.contains("Passphrase") || text.contains(" passphrase ") {
        if has_passphrase {
            format!("SSH 私钥口令错误: {text}")
        } else {
            "SSH 私钥已加密,需要配置口令(passphrase)".to_string()
        }
    } else {
        format!("SSH 私钥解析失败: {text}")
    }
}

/// 私钥路径展开:~ 前缀 + Windows 变量(仅非 Windows 上把盘符路径当相对)。
pub(crate) fn expand_ssh_private_key_path(path: &str) -> PathBuf {
    let trimmed = path.trim();
    let home = crate::session::home_dir();
    if let Some(rest) = trimmed.strip_prefix("~/") {
        return home.join(rest);
    }
    if trimmed == "~" {
        return home;
    }
    if let Some(rest) = trimmed.strip_prefix("~\\") {
        return home.join(rest);
    }
    PathBuf::from(trimmed)
}

/// 密码回落提示(user@host's password:)。
pub(crate) fn password_fallback_prompt_data(
    host: &SshHostWire,
    retry: bool,
) -> KeyboardInteractivePromptData {
    KeyboardInteractivePromptData {
        name: String::new(),
        instructions: if retry {
            "Permission denied, please try again.".to_string()
        } else {
            String::new()
        },
        prompt: format!("{}@{}'s password:", host.username.trim(), host.host.trim()),
        echo: false,
        answer_mode: SshPromptAnswerMode::Password,
    }
}

pub(crate) fn auth_result_can_continue_with_kbi(result: &client::AuthResult) -> bool {
    matches!(
        result,
        client::AuthResult::Failure {
            remaining_methods,
            ..
        } if remaining_methods.contains(&MethodKind::KeyboardInteractive)
    )
}

pub(crate) fn prompt_looks_like_password(prompt: &str) -> bool {
    let normalized = prompt.trim().to_ascii_lowercase();
    normalized.contains("password") || prompt.contains("密码")
}

pub(crate) enum PasswordKbiPromptAction {
    RespondEmpty,
    SendPassword,
    PromptUser,
}

pub(crate) fn classify_password_kbi_prompts(
    prompts: &[client::Prompt],
    password_prompt_consumed: bool,
) -> PasswordKbiPromptAction {
    if prompts.is_empty() {
        PasswordKbiPromptAction::RespondEmpty
    } else if !password_prompt_consumed
        && prompts.len() == 1
        && !prompts[0].echo
        && prompt_looks_like_password(&prompts[0].prompt)
    {
        PasswordKbiPromptAction::SendPassword
    } else {
        PasswordKbiPromptAction::PromptUser
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_repairs_paste_artifacts() {
        let raw = "\u{feff}-----BEGIN OPENSSH PRIVATE KEY-----\r\n abc \r\n\r\ndef\\nghi-----END OPENSSH PRIVATE KEY-----";
        let normalized = normalize_ssh_private_key_material(raw);
        assert!(normalized.starts_with("-----BEGIN OPENSSH PRIVATE KEY-----\n"));
        assert!(normalized.contains("abcdefghi"));
        assert!(normalized.ends_with("-----END OPENSSH PRIVATE KEY-----"));
    }

    #[test]
    fn normalize_folds_single_line_pem() {
        let collapsed = "noise-----BEGIN PRIVATE KEY-----AAABBBCCCDDDEEEFFFGGGHHHIIIJJJKKKLLLMMMNNNOOOPPPQQQRRRSSSTTTUUUVVVWWWXXXYYYZZZaaabbbcccddd---END doesn't match-----END PRIVATE KEY-----";
        let normalized = normalize_ssh_private_key_material(collapsed);
        let lines: Vec<&str> = normalized.lines().collect();
        assert_eq!(lines[0], "-----BEGIN PRIVATE KEY-----");
        /* 去掉与 END 标记混排的杂段后,正文按 64 列重排 */
        for line in lines.iter().skip(1).take(lines.len() - 2) {
            assert!(line.len() <= 64);
        }
    }

    #[test]
    fn legacy_encrypted_pem_untouched() {
        let legacy = "-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-256-CBC,x\n\nAAAA\n-----END RSA PRIVATE KEY-----";
        /* 含 PEM 头的旧式加密块不重排;清洗只去空行(逐行 trim + 过滤空行)。 */
        assert_eq!(
            normalize_ssh_private_key_material(legacy),
            "-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-256-CBC,x\nAAAA\n-----END RSA PRIVATE KEY-----"
        );
    }

    #[test]
    fn password_prompt_detection() {
        assert!(prompt_looks_like_password("user@host's password:"));
        assert!(prompt_looks_like_password("请输入密码"));
        assert!(!prompt_looks_like_password("Verification code"));
    }

    #[test]
    fn tilde_expansion() {
        let home = crate::session::home_dir();
        let expanded = expand_ssh_private_key_path("~/.ssh/id_ed25519");
        assert_eq!(expanded, home.join(".ssh/id_ed25519"));
        assert_eq!(
            expand_ssh_private_key_path("/opt/key"),
            PathBuf::from("/opt/key")
        );
    }
}
