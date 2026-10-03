/**
 * 发送闸(mobile composer)—— 纯函数,与 DOM/React 解耦(vitest 直测)。
 * send() 本体三条件收口(2026-10-03 评审:发送钮 disabled 只是 UI 闸,错误条
 * 「重试」钮与 ⌘/Ctrl+Enter 键路不经按钮,须在本体收口;抽纯函数钉死防漂移,
 * 先例 mobileEnterAction / joinPrompt)。
 * - sending:上一次发送在途(writeSession 经 ws 远程桥,RTT 可秒级);
 * - pending:图片上传在途(原图已到手、压缩/落盘未完,图不在发送快照里);
 * - shotBusy:选图/拍照流程在途(picker 相机页打开中,结果未定)。
 * 三者任一在途 = 不发:否则文字先发、在途图片随后落单「复活」或被连带清掉。
 */
export function canSend(sending: boolean, pending: boolean, shotBusy: boolean): boolean {
  return !(sending || pending || shotBusy);
}
