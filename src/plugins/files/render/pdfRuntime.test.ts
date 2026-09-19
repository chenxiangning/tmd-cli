/**
 * pdfRuntime 契约测试(pdf.js worker 运行时配置):
 * - ensurePdfPreviewWorker 首次调用把 GlobalWorkerOptions.workerSrc 指到随构建产出的 worker 地址;
 * - 重复调用幂等:模块级守卫保证不重复赋值。
 * pdfjs-dist 与 ?url 资源均 mock,node 环境不加载真实 pdf.js。
 */
import { describe, expect, it, vi } from "vitest";
import { ensurePdfPreviewWorker } from "./pdfRuntime";

const worker = vi.hoisted(() => ({ src: "", setCount: 0 }));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {
    get workerSrc() {
      return worker.src;
    },
    set workerSrc(value: string) {
      worker.setCount += 1;
      worker.src = value;
    },
  },
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "/mock/pdf.worker.min.mjs" }));

describe("ensurePdfPreviewWorker", () => {
  it("首次调用配置 workerSrc 为打包 worker 地址;重复调用幂等不重复赋值", () => {
    expect(worker.setCount).toBe(0);
    ensurePdfPreviewWorker();
    expect(worker.setCount).toBe(1);
    expect(worker.src).toBe("/mock/pdf.worker.min.mjs");
    ensurePdfPreviewWorker();
    ensurePdfPreviewWorker();
    expect(worker.setCount).toBe(1);
  });
});
