//! Web 桥模块:LAN 服务 + 命令 dispatch + 事件广播 + (M2)出站中继。

mod bind;
mod conn;
pub(crate) mod devices;
#[cfg(test)]
mod devices_tests;
mod dispatch;
mod dispatch_fs;
mod dispatch_git;
mod dispatch_git_branch;
mod dispatch_session;
mod dispatch_ssh;
pub mod file;
pub mod gate;
mod pair;
mod pinned_tls;
pub mod relay;
mod relay_agent;
mod relay_core;
pub mod server;
pub mod state;
pub mod web_access;
mod ws;
