//! /file 资源路由:镜像 asset:// 本地文件协议,范围收窄(见 read_scoped_file)。

use std::path::Path;
#[cfg(test)]
use std::path::PathBuf;

use axum::extract::{Query, State as AxumState};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;

use super::gate;
use super::server::WebCtx;

/// /file 单文件上限(壁纸/预览量级)。
const MAX_FILE_BYTES: usize = 32 * 1024 * 1024;

#[derive(Deserialize)]
pub(super) struct FileQuery {
    path: String,
    token: Option<String>,
}

pub(super) async fn file_handler(
    AxumState(ctx): AxumState<WebCtx>,
    Query(q): Query<FileQuery>,
) -> Response {
    if !gate::token_ok(q.token.as_deref(), &ctx.token) {
        return StatusCode::FORBIDDEN.into_response();
    }
    match read_scoped_file(Path::new(&q.path)) {
        Some((bytes, mime)) => {
            (StatusCode::OK, [(header::CONTENT_TYPE, mime)], bytes).into_response()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

/// /file 范围 = $HOME 内;首段 dot 条目默认拒绝(凭据/历史/OAuth 全在内:
/// .ssh/.aws/.claude/.codex/.local/.netrc/.zsh_history…),仅白名单 .tmd-cli
/// 放行且二级须 wallpapers/(壁纸插件 asset:// 的消费路径);非 dot 路径维持
/// 放行(工作区预览)。canonicalize 后仍须在 $HOME 内,symlink 与 `..` 无法
/// 逃逸。较 assetProtocol 的 `**/*` 收窄,属 trust-boundary。
fn read_scoped_file(path: &Path) -> Option<(Vec<u8>, &'static str)> {
    let home = crate::session::home_dir();
    let canonical = path.canonicalize().ok()?;
    if !canonical.starts_with(&home) || !canonical.is_file() {
        return None;
    }
    let rel = canonical.strip_prefix(&home).ok()?;
    let first = rel.components().next()?.as_os_str().to_str()?;
    /* 允许制:黑名单枚举追不完新 CLI 的凭据落点,dot 首段一刀切更稳。 */
    if first.starts_with('.') && first != ".tmd-cli" {
        return None;
    }
    if first == ".tmd-cli"
        && rel.components().nth(1).map(|c| c.as_os_str())
            != Some(std::ffi::OsStr::new("wallpapers"))
    {
        return None;
    }
    /* 先验大小再读:不把超大文件整读进内存。 */
    let len = std::fs::metadata(&canonical).ok()?.len();
    if len > MAX_FILE_BYTES as u64 {
        return None;
    }
    let bytes = std::fs::read(&canonical).ok()?;
    Some((bytes, content_type(canonical.to_str()?)))
}

fn content_type(path: &str) -> &'static str {
    let ext = path
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home_rel(rel: &str) -> PathBuf {
        crate::session::home_dir().join(rel)
    }

    #[test]
    fn 凭据目录一律拒绝() {
        assert!(read_scoped_file(&home_rel(".ssh/id_rsa")).is_none());
        assert!(read_scoped_file(&home_rel(".aws/credentials")).is_none());
        assert!(read_scoped_file(&home_rel(".gnupg/pubring.kbx")).is_none());
        assert!(read_scoped_file(&home_rel(".config/any.toml")).is_none());
    }

    #[test]
    fn tmd_cli_下仅壁纸目录放行() {
        assert!(read_scoped_file(&home_rel(".tmd-cli/settings.json")).is_none());
        assert!(read_scoped_file(&home_rel(".tmd-cli/checkpoints/x/y")).is_none());
        /* wallpapers 下不存在的文件也会过 scope 检查,仅读盘阶段 404;
        用存在的文件验证 scope 放行(临时造一个)。 */
        let dir = home_rel(".tmd-cli/wallpapers");
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("scope-probe.png");
        std::fs::write(&f, b"fake").unwrap();
        assert!(read_scoped_file(&f).is_some());
        let _ = std::fs::remove_file(&f);
    }

    #[test]
    fn home_之外一律拒绝() {
        assert!(read_scoped_file(Path::new("/etc/hosts")).is_none());
        assert!(read_scoped_file(Path::new("/var/log/system.log")).is_none());
    }

    #[test]
    fn 家目录内普通文件放行() {
        let f = home_rel("tmd-file-scope-probe.txt");
        std::fs::write(&f, b"ok").unwrap();
        assert!(read_scoped_file(&f).is_some());
        let _ = std::fs::remove_file(&f);
    }
}
