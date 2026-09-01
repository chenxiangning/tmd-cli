/**
 * VS Code light 主题 preset 数据 —— 移植自 codemoss features/theme/constants/vscodeThemePresets.ts(勿手改,说明见 ./index.ts)。
 */
import type { ThemePresetDefinition, ThemePresetId } from "./index";

import { LIGHT_PRESETS_PART1 } from "./light1";
import { LIGHT_PRESETS_PART2 } from "./light2";

export const LIGHT_PRESETS = {
  ...LIGHT_PRESETS_PART1,
  ...LIGHT_PRESETS_PART2,
} as unknown as Record<ThemePresetId, Omit<ThemePresetDefinition, "id">>;
