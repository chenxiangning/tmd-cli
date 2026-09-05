//! SSH 认证 —— password / privateKey / keyboard-interactive 多轮。
//! 认证状态机与 PEM 清洗自研;错误文案中文化。
//! 材料解析/PEM 清洗/KBI 提示分类 → auth_material.rs(文件规模铁则)。

use russh::client;
use russh::keys::ssh_key::HashAlg;
use russh::keys::PrivateKeyWithHashAlg;
use russh::MethodKind;

use super::auth_material::{
    auth_result_can_continue_with_kbi, classify_password_kbi_prompts,
    describe_private_key_decode_error, password_fallback_prompt_data, PasswordKbiPromptAction,
};
use super::transport::SshHostWire;

/// 材料解析在 auth_material.rs;此处 re-export 保持 super::auth:: 引用路径不变。
pub(crate) use super::auth_material::resolve_ssh_auth_material;

/// 解析后的认证材料(凭据只进内存,不落盘)。
pub(crate) enum ResolvedSshAuth {
    Password(String),
    PrivateKey {
        key: String,
        passphrase: Option<String>,
    },
    KeyboardInteractive,
}

/// 认证结果:成功,或需要用户输入(host key 密码回落 / KBI)。
#[derive(Debug)]
pub(crate) enum SshAuthOutcome {
    Authenticated,
    /// 需要用户输入:name/instructions/prompt 文本 + echo。
    KeyboardInteractivePrompt(KeyboardInteractivePromptData),
}

#[derive(Debug, Clone)]
pub(crate) struct KeyboardInteractivePromptData {
    pub name: String,
    pub instructions: String,
    pub prompt: String,
    pub echo: bool,
    /// password = 密码回落( Russh 密码认证复用),kbi = KBI 应答回传。
    pub answer_mode: SshPromptAnswerMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SshPromptAnswerMode {
    KeyboardInteractive,
    Password,
}

/// 主认证入口:
/// password/privateKey 失败但服务器允许 KBI → 自动回落 KBI;KBI 密码类提示
/// 有自动密码则代答,否则返回 Prompt 交给前端;RSA hash 走服务器协商。
pub(crate) async fn authenticate_ssh_handle(
    handle: &mut client::Handle<super::transport::SshClient>,
    host: &SshHostWire,
    auth: ResolvedSshAuth,
) -> Result<SshAuthOutcome, String> {
    match auth {
        ResolvedSshAuth::Password(password) => {
            let result = handle
                .authenticate_password(host.username.as_str(), password.clone())
                .await
                .map_err(|error| format!("SSH 密码认证失败: {error}"))?;
            if result.success() {
                return Ok(SshAuthOutcome::Authenticated);
            }
            if auth_result_can_continue_with_kbi(&result) {
                let response = handle
                    .authenticate_keyboard_interactive_start(host.username.as_str(), None::<String>)
                    .await
                    .map_err(|error| format!("SSH 键盘交互认证失败: {error}"))?;
                return continue_keyboard_interactive_auth(handle, response, Some(password)).await;
            }
            Err("SSH 认证失败(密码被拒绝)".to_string())
        }
        ResolvedSshAuth::PrivateKey { key, passphrase } => {
            let key_pair = russh::keys::decode_secret_key(&key, passphrase.as_deref())
                .map_err(|error| describe_private_key_decode_error(&error, passphrase.is_some()))?;
            /* RSA 签名 hash 从服务器 server-sig-algs(RFC 8308)协商:
            只认 ssh-rsa 的老服务器上硬编码 SHA-256 会失败。 */
            let hash_alg = if key_pair.algorithm().is_rsa() {
                handle
                    .best_supported_rsa_hash()
                    .await
                    .map_err(|error| format!("SSH 私钥认证失败: {error}"))?
                    .unwrap_or(Some(HashAlg::Sha256))
            } else {
                None
            };
            let key = PrivateKeyWithHashAlg::new(std::sync::Arc::new(key_pair), hash_alg);
            let result = handle
                .authenticate_publickey(host.username.as_str(), key)
                .await
                .map_err(|error| format!("SSH 私钥认证失败: {error}"))?;
            if result.success() {
                return Ok(SshAuthOutcome::Authenticated);
            }
            if auth_result_can_continue_with_kbi(&result) {
                let response = handle
                    .authenticate_keyboard_interactive_start(host.username.as_str(), None::<String>)
                    .await
                    .map_err(|error| format!("SSH 键盘交互认证失败: {error}"))?;
                return continue_keyboard_interactive_auth(handle, response, None).await;
            }
            Err("SSH 认证失败(私钥被拒绝)".to_string())
        }
        ResolvedSshAuth::KeyboardInteractive => {
            let response = handle
                .authenticate_keyboard_interactive_start(host.username.as_str(), None::<String>)
                .await
                .map_err(|error| format!("SSH 键盘交互认证失败: {error}"))?;
            /* 服务器禁 KBI(如 KbdInteractiveAuthentication no)时:
            仍允许 password 则走密码回落提问,否则明确报错。 */
            if let client::KeyboardInteractiveAuthResponse::Failure {
                remaining_methods, ..
            } = &response
            {
                if remaining_methods.contains(&MethodKind::Password) {
                    return Ok(SshAuthOutcome::KeyboardInteractivePrompt(
                        password_fallback_prompt_data(host, false),
                    ));
                }
                return Err("该服务器不支持键盘交互认证".to_string());
            }
            continue_keyboard_interactive_auth(handle, response, None).await
        }
    }
}

/// 密码回落:用用户输入的密码走一次密码认证,失败时给重试提示。
pub(crate) async fn password_fallback_authenticate(
    handle: &mut client::Handle<super::transport::SshClient>,
    host: &SshHostWire,
    password: &str,
) -> Result<SshAuthOutcome, String> {
    let result = handle
        .authenticate_password(host.username.as_str(), password.to_string())
        .await
        .map_err(|error| format!("SSH 密码认证失败: {error}"))?;
    if result.success() {
        return Ok(SshAuthOutcome::Authenticated);
    }
    Ok(SshAuthOutcome::KeyboardInteractivePrompt(
        password_fallback_prompt_data(host, true),
    ))
}

/// KBI 多轮(上限 SSH_KBI_MAX_ROUNDS):密码类提示有自动密码代答,
/// 其余单提示返回给前端;空提示集回空串继续。
pub(crate) async fn continue_keyboard_interactive_auth(
    handle: &mut client::Handle<super::transport::SshClient>,
    mut response: client::KeyboardInteractiveAuthResponse,
    auto_password: Option<String>,
) -> Result<SshAuthOutcome, String> {
    let mut password_prompt_consumed = false;
    for _ in 0..super::SSH_KBI_MAX_ROUNDS {
        match response {
            client::KeyboardInteractiveAuthResponse::Success => {
                return Ok(SshAuthOutcome::Authenticated);
            }
            client::KeyboardInteractiveAuthResponse::Failure { .. } => {
                return Err("SSH 键盘交互认证失败".to_string());
            }
            client::KeyboardInteractiveAuthResponse::InfoRequest {
                name,
                instructions,
                prompts,
            } => match classify_password_kbi_prompts(&prompts, password_prompt_consumed) {
                PasswordKbiPromptAction::RespondEmpty => {
                    response = handle
                        .authenticate_keyboard_interactive_respond(Vec::new())
                        .await
                        .map_err(|error| format!("SSH 键盘交互应答失败: {error}"))?;
                }
                PasswordKbiPromptAction::SendPassword if auto_password.is_some() => {
                    password_prompt_consumed = true;
                    response = handle
                        .authenticate_keyboard_interactive_respond(vec![auto_password
                            .clone()
                            .unwrap_or_default()])
                        .await
                        .map_err(|error| format!("SSH 键盘交互应答失败: {error}"))?;
                }
                PasswordKbiPromptAction::SendPassword | PasswordKbiPromptAction::PromptUser => {
                    if prompts.len() != 1 {
                        return Err("SSH 键盘交互请求了多个提示,暂不支持".to_string());
                    }
                    let prompt = prompts
                        .into_iter()
                        .next()
                        .ok_or_else(|| "SSH 键盘交互提示为空".to_string())?;
                    return Ok(SshAuthOutcome::KeyboardInteractivePrompt(
                        KeyboardInteractivePromptData {
                            name,
                            instructions,
                            prompt: prompt.prompt,
                            echo: prompt.echo,
                            answer_mode: SshPromptAnswerMode::KeyboardInteractive,
                        },
                    ));
                }
            },
        }
    }
    Err("SSH 键盘交互轮次超限".to_string())
}
