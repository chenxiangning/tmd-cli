//! Web 桥模块:LAN 服务 + 命令 dispatch + 事件广播 + (M2)出站中继。

pub mod dispatch;
mod dispatch_fs;
mod dispatch_git;
mod dispatch_git_branch;
mod dispatch_session;
mod dispatch_ssh;
pub mod file;
pub mod gate;
pub mod server;
pub mod state;
pub mod web_access;
