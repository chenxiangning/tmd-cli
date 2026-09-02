//! git 集成测试公共设施 —— TempRepo(文件规模铁则:从 tests.rs 拆出共享)。
//! 不引 tempfile:std::env::temp_dir + 进程/时间戳构造唯一目录,Drop 清理。

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

static SEQ: AtomicU64 = AtomicU64::new(0);

pub(crate) struct TempRepo {
    pub dir: PathBuf,
}

impl TempRepo {
    /// git2 建 repo + repo 级临时 user config(签名需要,不污染全局)
    pub(crate) fn new() -> Self {
        let seq = SEQ.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("tmd-git-test-{}-{seq}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let repo = git2::Repository::init(&dir).unwrap();
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "t").unwrap();
        cfg.set_str("user.email", "t@t").unwrap();
        Self { dir }
    }

    pub(crate) fn write(&self, name: &str, content: &str) {
        fs::write(self.dir.join(name), content).unwrap();
    }

    pub(crate) fn path(&self) -> &str {
        self.dir.to_str().unwrap()
    }
}

impl Drop for TempRepo {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}
