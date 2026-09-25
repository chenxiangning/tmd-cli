//! Web 访问桥 —— 把同一前端经 LAN HTTP/WS 暴露给手机等第二表面。
//! 闸门:M1 仅 URL token(每次启动新铸,挡同 Wi-Fi 陌生人);relay/设备配对随 M2。

/// 令牌字母表:去歧义字符(无 0/O/1/l/I),人工抄录不出错。
const TOKEN_ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

/// 铸造访问令牌(24 字符,CSPRNG;每次启动新铸 = 旧链接全部失效)。
pub(super) fn new_token() -> String {
    gen(24)
}

/// 任意长度令牌(同字母表);设备 token/配对码共用。
pub(super) fn gen(len: usize) -> String {
    use rand::Rng;
    let mut rng = rand::rng();
    (0..len)
        .map(|_| TOKEN_ALPHABET[rng.random_range(0..TOKEN_ALPHABET.len())] as char)
        .collect()
}

/// token 比对:WS 握手与 /file 的唯一凭据(M1)。两侧先散列再比较,
/// 把时序侧信道压到哈希输出宽度(24 字符 CSPRNG 下本就不可行,纵深加固)。
pub(super) fn token_ok(supplied: Option<&str>, expected: &str) -> bool {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let supplied = match supplied {
        Some(t) => t,
        None => return false,
    };
    let (mut a, mut b) = (DefaultHasher::new(), DefaultHasher::new());
    supplied.hash(&mut a);
    expected.hash(&mut b);
    a.finish() == b.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 新令牌形状与比对() {
        let token = new_token();
        assert_eq!(token.len(), 24);
        assert!(token.chars().all(|c| TOKEN_ALPHABET.contains(&(c as u8))));
        assert!(token_ok(Some(&token), &token));
        assert!(!token_ok(None, &token));
        assert!(!token_ok(Some(""), &token));
        assert!(!token_ok(Some(&format!("{token}x")), &token));
        assert!(!token_ok(Some(&token[..23]), &token));
    }
}
