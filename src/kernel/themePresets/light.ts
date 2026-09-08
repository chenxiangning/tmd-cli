/**
 * VS Code light 主题 preset 数据 —— 移植自 codemoss features/theme/constants/vscodeThemePresets.ts(勿手改,说明见 ./index.ts)。
 */
import type { ThemePresetDefinition, ThemePresetId } from "./index";

import { LIGHT_PRESETS_PART1 } from "./light1";
import { LIGHT_PRESETS_PART2 } from "./light2";
import { LIGHT_PRESETS_PART3 } from "./light3";
import { LIGHT_PRESETS_PART4 } from "./light4";
import { LIGHT_PRESETS_PART5 } from "./light5";
import { LIGHT_PRESETS_PART6 } from "./light6";
import { LIGHT_PRESETS_PART7 } from "./light7";

export const LIGHT_PRESETS = {
  ...LIGHT_PRESETS_PART1,
  ...LIGHT_PRESETS_PART2,
  ...LIGHT_PRESETS_PART3,
  ...LIGHT_PRESETS_PART4,
  ...LIGHT_PRESETS_PART5,
  ...LIGHT_PRESETS_PART6,
  ...LIGHT_PRESETS_PART7,
} as unknown as Record<ThemePresetId, Omit<ThemePresetDefinition, "id">>;
