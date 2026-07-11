import { createHash } from "node:crypto";

function sortRecursively(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortRecursively(entry));
  }

  if (value !== null && typeof value === "object") {
    const sortedEntries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortRecursively(child)] as const);
    return Object.fromEntries(sortedEntries);
  }

  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortRecursively(value));
}

export function computeContentHash(value: unknown): string {
  const payload = typeof value === "string" ? value : stableStringify(value);
  const digest = createHash("sha256").update(payload).digest("hex");
  return `sha256:${digest}`;
}
