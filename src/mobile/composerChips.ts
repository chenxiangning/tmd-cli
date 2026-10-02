/**
 * 挂图提示 chips 数据(spec 2026-10-03-mobile-composer-redesign):
 * 参考图三条文案 → 预填草稿提示词;点 chip 只填草稿,发送由人确认(不自动发)。
 * 独立纯数据模块:组件文件不混数据导出(react-doctor only-export-components)。
 */
export const CHIP_PROMPTS: ReadonlyArray<{ label: string; prompt: string }> = [
  { label: "提取图中文字", prompt: "请提取图片中的文字" },
  { label: "图片配文", prompt: "请为这张图片配一段文字说明" },
  { label: "翻译图中文字", prompt: "请翻译图片中的文字为中文" },
];
