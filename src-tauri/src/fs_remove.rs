//! 白名单删除原语 —— 只对各 CLI 会话数据目录与本应用临时区开放。
//! 自 fs.rs 拆出(文件规模铁则):renderer 不可信,canonical 前缀校验后才删。

use std::fs;

/// 删除操作允许的 canonical 根前缀 —— 各 CLI 会话数据目录 + 本应用临时区。
/// 与 docs/architecture/02-code-architecture.md §5.1 的会话存储表对应;
/// 新增 CLI 插件时同步维护此表。绝对禁止:文件系统根、home 本身及白名单外的任意路径。
fn allowed_remove_roots() -> Vec<std::path::PathBuf> {
    /* 根也须 canonicalize:macOS 的 temp_dir 在 /var(→/private/var 符号链接)下,
     * 与入参路径的 canonical 形态比较前必须同基准。根可能尚不存在(未创建),
     * canonicalize 失败时退回原始形态 —— 此时其下路径也不存在,删除走 NotFound 幂等。 */
    fn canon_or_self(p: std::path::PathBuf) -> std::path::PathBuf {
        p.canonicalize().unwrap_or(p)
    }
    let home = crate::session::home_dir();
    let mut roots: Vec<std::path::PathBuf> = [
        ".omp",
        // dsh 会话盘(host 无删除 RPC,会话删除走本原语移除 <slug>/session-<id> 目录)
        ".dsh",
        ".pi",
        ".claude",
        ".codex",
        ".kimi",
        // kimi-code 0.40 起数据 home 迁到 ~/.kimi-code(.migrated-to-kimi-code 标记),
        // 新会话全落这里;老 .kimi 仅存未迁移机器的会话,两个都得放行。
        ".kimi-code",
        ".grok",
        ".qoder",
        ".qoder-cn",
        ".tmd-cli",
    ]
    .iter()
    .map(|d| home.join(d))
    .map(canon_or_self)
    .collect();
    roots.push(canon_or_self(std::env::temp_dir().join("tmd-cli")));
    roots
}
/// 安全面:renderer 不可信,删除原语只对白名单根前缀内的 canonical 路径开放。
pub fn remove_path(path: &str) -> Result<(), String> {
    let p = std::path::Path::new(path);
    let canonical = match p.canonicalize() {
        Ok(c) => c,
        /* 路径不存在 = 删除已达成:幂等语义在此兑现,不进白名单检查 */
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("路径不可解析: {e}")),
    };
    let ok = allowed_remove_roots()
        .iter()
        .any(|root| canonical.starts_with(root));
    if !ok {
        return Err(format!("拒绝删除白名单外的路径: {path}"));
    }
    let result = if canonical.is_dir() {
        fs::remove_dir_all(&canonical)
    } else {
        fs::remove_file(&canonical)
    };
    match result {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("删除失败: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// remove_path 测试专用根:temp_dir()/tmd-cli 本身就在白名单内。
    fn remove_test_root(tag: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir()
            .join("tmd-cli")
            .join(format!("remove-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("创建临时目录失败");
        root
    }

    #[test]
    fn remove_path_删文件删目录且对缺失路径幂等() {
        let root = remove_test_root("ok");
        let file = root.join("session.jsonl");
        fs::write(&file, "{}\n").unwrap();

        // 存在的文件:删除成功且确实消失
        remove_path(file.to_str().unwrap()).unwrap();
        assert!(!file.exists());
        // 再删一次(竞态/重试语义):NotFound 幂等成功,不得报错
        remove_path(file.to_str().unwrap()).unwrap();

        // 目录(含嵌套内容):整树删除 —— kimi 会话目录形态
        let dir = root.join("910a");
        fs::create_dir_all(dir.join("uuid")).unwrap();
        fs::write(dir.join("uuid").join("wire.jsonl"), "{}\n").unwrap();
        remove_path(dir.to_str().unwrap()).unwrap();
        assert!(!dir.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn remove_path_拒绝白名单外的路径() {
        // 白名单外(临时目录散列根)的路径必须被拒,防 renderer 任意删除
        let outside = std::env::temp_dir().join(format!("tmd-outside-{}", std::process::id()));
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("x.txt"), "keep").unwrap();
        let err = remove_path(outside.to_str().unwrap()).unwrap_err();
        assert!(err.contains("白名单"), "应报白名单拒绝: {err}");
        assert!(outside.join("x.txt").exists(), "白名单外文件不得被动");
        let _ = fs::remove_dir_all(&outside);

        // 存在的文件 + 白名单内:正常删除(正例对照)
        let root = remove_test_root("allow");
        fs::write(root.join("y.txt"), "x").unwrap();
        remove_path(root.join("y.txt").to_str().unwrap()).unwrap();
        assert!(!root.join("y.txt").exists());
        let _ = fs::remove_dir_all(&root);
    }
    #[test]
    fn 白名单覆盖各家_cli_会话盘() {
        // 每家 CLI 的会话删除都依赖本原语放行对应 home 目录;
        // 新增引擎时在此补一行,防止编辑踩掉既有项(2026-09-07 .omp 被覆盖实测)。
        let roots = allowed_remove_roots();
        for dir in [
            ".omp",
            ".dsh",
            ".pi",
            ".claude",
            ".codex",
            ".kimi",
            ".kimi-code",
            ".grok",
            ".qoder",
            ".qoder-cn",
        ] {
            let p = crate::session::home_dir().join(dir);
            let canonical = p.canonicalize().unwrap_or(p);
            assert!(
                roots.iter().any(|root| root == &canonical),
                "{} 必须在删除白名单内",
                dir
            );
        }
    }
}
