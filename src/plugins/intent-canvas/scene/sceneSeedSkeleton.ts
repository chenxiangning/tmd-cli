/**
 * 意图画布 · 场景引擎种子文件(空画布的演示骨架,移植自 mossx scene.ts)。
 */
import type { IntentCanvasOpenSource } from "../types";
import type { SeedShape } from "./sceneElements";

export function buildSeedSkeleton(source: IntentCanvasOpenSource | null | undefined): SeedShape[] {
  const nodeTitle = source?.nodeTitle?.trim();
  const filePath = source?.filePath?.trim();
  const summary = source?.summary?.trim();
  if (nodeTitle || filePath) {
    const primaryLabel = nodeTitle || filePath || "Intent Node";
    const secondaryLabel = filePath && nodeTitle ? filePath : summary || "Describe the logic here";
    return [
      {
        type: "rectangle",
        x: 120,
        y: 160,
        width: 260,
        height: 92,
        strokeColor: "#2563eb",
        backgroundColor: "#eff6ff",
      },
      {
        type: "text",
        x: 130,
        y: 188,
        width: 230,
        height: 32,
        text: secondaryLabel,
        fontSize: 16,
        strokeColor: "#475569",
      },
      {
        type: "text",
        x: 130,
        y: 166,
        width: 230,
        height: 30,
        text: primaryLabel,
        fontSize: 22,
        strokeColor: "#1d4ed8",
      },
      {
        type: "arrow",
        x: 420,
        y: 205,
        width: 220,
        height: 0,
        strokeColor: "#0f172a",
      },
      {
        type: "rectangle",
        x: 680,
        y: 160,
        width: 260,
        height: 92,
        strokeColor: "#0f766e",
        backgroundColor: "#ecfdf5",
      },
      {
        type: "text",
        x: 700,
        y: 188,
        width: 220,
        height: 32,
        text: "Next Module",
        fontSize: 22,
        strokeColor: "#0f766e",
      },
    ];
  }

  return [
    {
      type: "rectangle",
      x: 120,
      y: 160,
      width: 260,
      height: 92,
      strokeColor: "#2563eb",
      backgroundColor: "#eff6ff",
    },
    {
      type: "text",
      x: 140,
      y: 188,
      width: 220,
      height: 32,
      text: "Auth Service",
      fontSize: 22,
      strokeColor: "#1d4ed8",
    },
    {
      type: "arrow",
      x: 420,
      y: 205,
      width: 220,
      height: 0,
      strokeColor: "#0f172a",
    },
    {
      type: "rectangle",
      x: 680,
      y: 160,
      width: 260,
      height: 92,
      strokeColor: "#0f766e",
      backgroundColor: "#ecfdf5",
    },
    {
      type: "text",
      x: 700,
      y: 188,
      width: 220,
      height: 32,
      text: "User DB",
      fontSize: 22,
      strokeColor: "#0f766e",
    },
  ];
}


