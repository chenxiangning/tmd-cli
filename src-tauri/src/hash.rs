//! 哈希原语 —— 目前只有 MD5,给 kimi CLI 的会话目录定位用。
//!
//! 背景:kimi 把会话落盘在 `~/.kimi/sessions/<MD5(cwd)>/<uuid>/wire.jsonl`,
//! 会话文件内不记录 cwd,MD5(cwd) 是 cwd → 会话目录的唯一映射(0.34 实证,
//! `printf '<path>' | md5` 与真实目录名一致)。
//!
//! 设计决策:
//! - 通用原语进内核命令面,不携带任何 CLI 语义(与 fs_read_tail 同层);
//!   "kimi 用 MD5 当目录 slug" 这条私有知识留在 cli-kimi 插件里。
//! - md-5(RustCrypto)而非手写 —— 胶水原则,不手写哈希算法。
//! - 阻塞安全:纯内存计算,微秒级,Tauri command 直接同步执行无碍。

use md5::{Digest, Md5};

/// UTF-8 字符串 → 小写十六进制 MD5(32 字符)。与 `printf '%s' <text> | md5` 一致(无尾随换行)。
pub fn md5_hex(text: String) -> String {
    let mut hasher = Md5::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::md5_hex;

    #[test]
    fn rfc1321_标准向量() {
        assert_eq!(md5_hex("".into()), "d41d8cd98f00b204e9800998ecf8427e");
        assert_eq!(md5_hex("abc".into()), "900150983cd24fb0d6963f7d28e17f72");
    }

    #[test]
    fn 路径哈希与本机_kimi_会话目录一致() {
        // 实证:本机 ~/.kimi/sessions/ 的真实哈希目录(2026-09-02)。
        assert_eq!(
            md5_hex("/Users/chenxiangning/code/AI/github/mossx".into()),
            "910a1f52549942462008d9c0a0b04ef5"
        );
        assert_eq!(
            md5_hex("/Users/chenxiangning".into()),
            "eda2864237b211330e17f4cddec28117"
        );
    }
}
