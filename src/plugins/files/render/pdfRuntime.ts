/**
 * pdf.js worker 运行时 —— 照抄 codemoss pdfPreviewRuntime.ts。
 * worker 以 ?url 资源随构建产出,首次进 PDF 预览才配置 GlobalWorkerOptions。
 */

import { GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

let workerConfigured = false;

export function ensurePdfPreviewWorker() {
  if (workerConfigured) {
    return;
  }
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  workerConfigured = true;
}
