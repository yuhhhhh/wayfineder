const SECRET_KEY_PATTERN = /(?:secret|token|password|authorization|cookie|api[_-]?key|path|file(?:name)?)/i;
const SECRET_VALUE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\b(?:gh[opusr]_[A-Za-z0-9]{20,})\b/g,
  /\b[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY)=[^\s]+/g,
];

const MAX_STRING_LENGTH = 2_000;
const MAX_ARRAY_ITEMS = 100;
const MAX_OBJECT_KEYS = 100;
const MAX_DEPTH = 8;

export function redactText(value: string): string {
  let redacted = value.slice(0, MAX_STRING_LENGTH);
  for (const pattern of SECRET_VALUE_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  return redacted;
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth >= MAX_DEPTH) return "[TRUNCATED]";
  if (typeof value === "string") return redactText(value);
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((entry) => redactValue(entry, depth + 1));
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
    output[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redactValue(entry, depth + 1);
  }
  return output;
}
