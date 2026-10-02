/**
 * 手势失败轻提示呈现面 —— 右下角非阻塞 toast(role=status),6s 自动消失。
 * 状态源 gestureNotice.ts(cmLsp 语义路径触发,60s 节流);seq 递增触发重挂,
 * 连续到期时定时器重计。样式 lsp-gesture.css。
 */

import { useEffect, useState } from "react";
import { useGestureNotice } from "./gestureNotice";

/** 自动消失时长:轻提示,读到即收。 */
const NOTICE_TTL_MS = 6_000;

function GestureToastCard({ message }: { message: string }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), NOTICE_TTL_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!visible) return null;
  return (
    <div className="lsp-gesture-toast" role="status">
      {message}
    </div>
  );
}

export function GestureNoticeOverlay() {
  const notice = useGestureNotice();
  if (!notice) return null;
  return <GestureToastCard key={notice.seq} message={notice.message} />;
}
