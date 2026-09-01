/**
 * VS Code dark 主题 preset 数据 —— 移植自 codemoss features/theme/constants/vscodeThemePresets.ts(勿手改,说明见 ./index.ts)。
 */
import type { ThemePresetDefinition, ThemePresetId } from "./index";

import { DARK_PRESETS_PART1 } from "./dark1";
import { DARK_PRESETS_PART2 } from "./dark2";

export const DARK_PRESETS = {
  ...DARK_PRESETS_PART1,
  ...DARK_PRESETS_PART2,
} as unknown as Record<ThemePresetId, Omit<ThemePresetDefinition, "id">>;
