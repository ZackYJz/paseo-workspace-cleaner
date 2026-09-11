import { useSettings } from "@getpaseo/plugin/client";
import { cleanerSettings, type CleanerPreferences } from "../shared/settings";

// 默认值只有一个来源：settings schema。设置未就绪时用它兜底，就绪后由调用方纠正。
const schemaDefaults: CleanerPreferences = cleanerSettings.schema.parse({});

export function useCleanupDefaults(): CleanerPreferences {
  const settings = useSettings(cleanerSettings);
  return settings.status === "ready" ? settings.values : schemaDefaults;
}
