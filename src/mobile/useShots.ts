/**
 * 已挂图片状态(会话屏 composer 预览挂载):选图(native PHPicker)/拍照
 * (takePhoto 桥)→ 原图即时 pending 预览 → 压缩 → 桥落盘临时文件 → 缩略图
 * 上屏(remote.attachShot);移除/发送/卸载统一释放 objectURL(在途到货于
 * 卸载后 = 即时 revoke,防孤儿 blob URL);发送拼装走 composeSendText,
 * 这里只管挂载生命周期。错误条 3s 自清定时器归本 hook 单点管理(新错误
 * 到达先清旧定时器,免交叠提前清错 —— UI 策略不进 remote 层)。
 */
import { useEffect, useRef, useState } from "react";
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
  const ref = useRef(shots);
  useEffect(() => {
    ref.current = shots;
  });
  /* 卸载标记:在途上传到货时 setShots 已是 no-op,终态 objectURL 须当场释放 */
  const alive = useRef(true);
  const errTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      alive.current = false;
      clearTimeout(errTimer.current);
      for (const s of ref.current) URL.revokeObjectURL(s.url);
    },
    [],
  );
  /* flashErr = 单次错误上报;3s 自清是 UI 策略,新错误先清旧定时器免交叠 */
  const flashErr = (v: ShotErr): void => {
    setErr(v);
    if (v === null) return;
    clearTimeout(errTimer.current);
    errTimer.current = setTimeout(() => setErr(null), 3000);
  };

  const attach = (source: ShotSource): void => {
    void attachShot(
      {
        isBusy: busy,
        setBusy,
        onShot: (s) => {
          if (!alive.current) {
            URL.revokeObjectURL(s.url); /* 卸载后到货:不留孤儿 blob URL */
            return;
          }
          setShots((a) => [...a, s]);
        },
        flashErr,
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
  return { shots, pending, onShot, onPhoto, removeShot, clearShots, busy, err };
}
