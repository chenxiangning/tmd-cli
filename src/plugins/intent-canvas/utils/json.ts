export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function toJsonValueWithSeen(value: unknown, seen: WeakSet<object>): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return null;
    }
    seen.add(value);
    return value.map((item) => toJsonValueWithSeen(item, seen));
  }
  if (value instanceof Map) {
    if (seen.has(value)) {
      return null;
    }
    seen.add(value);
    const mapped: JsonObject = {};
    value.forEach((mapValue, mapKey) => {
      if (typeof mapKey === "string") {
        mapped[mapKey] = toJsonValueWithSeen(mapValue, seen);
      }
    });
    return mapped;
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) {
      return null;
    }
    seen.add(value);
    const record: JsonObject = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, recordValue]) => {
      if (typeof recordValue !== "function" && typeof recordValue !== "symbol") {
        record[key] = toJsonValueWithSeen(recordValue, seen);
      }
    });
    return record;
  }
  return null;
}

export function toJsonValue(value: unknown): JsonValue {
  return toJsonValueWithSeen(value, new WeakSet<object>());
}

export function toJsonObject(value: unknown): JsonObject {
  const jsonValue = toJsonValue(value);
  return isRecord(jsonValue) ? jsonValue : {};
}
