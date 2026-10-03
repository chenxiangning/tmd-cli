/**
 * 已挂图片状态(会话屏 composer 预览挂载):选图(native PHPicker)/拍照
 * (takePhoto 桥)→ 原图即时 pending 预览 → 压缩 → 桥落盘临时文件 → 缩略图
 * 上屏(remote.attachShot);移除/发送/卸载统一释放 objectURL。发送拼装走
 * composeSendText,这里只管挂载生命周期。
 */
import React, { useEffect, useState } from "react";
import { attachShot, type ShotErr, type ShotSource } from "./remote";

export interface Shot {
  path: string;
  url: string;
}

export function useShots(): {
  shots: Shot[];
  /** 上传中原图预览(objectURL;null = 无上传在途)。 */
  pending: string | null;
  /** 相册选图入口(PHPicker)。 */
  onShot: () => void;
  /** 拍照入口(相机拍摄上传)。 */
  onPhoto: () => void;
  removeShot: (path: string) => void;
  clearShots: () => void;
  busy: boolean;
  /** 错误条分档:null 无错;album/camera 对应选图/拍照失败文案。 */
  err: ShotErr;
} {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ShotErr>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  /* 卸载清理要拿最新表;镜像在 effect 落(ref 渲染期变更会挨 react-doctor) */
  const ref = React.useRef(shots);
  React.useEffect(() => {
    ref.current = shots;
  });

  const attach = (source: ShotSource): void => {
    void attachShot(
      {
        isBusy: busy,
        setBusy,
        onShot: (s) => setShots((a) => [...a, s]),
        flashErr: setErr,
        onPending: setPending,
        onPendingDone: () => setPending(null),
      },
      { source },
    );
  };
  const onShot = (): void => attach("album");
  const onPhoto = (): void => attach("camera");
  const removeShot = (path: string): void => {
    const s = ref.current.find((x) => x.path === path);
    if (s) URL.revokeObjectURL(s.url);
    setShots((a) => a.filter((x) => x.path !== path));
  };
  const clearShots = (): void => {
    for (const s of ref.current) URL.revokeObjectURL(s.url);
    setShots([]);
  };
  useEffect(
    () => () => {
      for (const s of ref.current) URL.revokeObjectURL(s.url);
    },
    [],
  );
  return { shots, pending, onShot, onPhoto, removeShot, clearShots, busy, err };
}
