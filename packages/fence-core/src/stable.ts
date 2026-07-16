import { createHash } from "node:crypto";

function sortRecursively(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortRecursively(entry));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortRecursively(child)]),
    );
  }

  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortRecursively(value));
}

export function sha256Digest(value: unknown): string {
  const payload = typeof value === "string" ? value : stableStringify(value);
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}
