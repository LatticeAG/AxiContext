import path from "node:path";
import { fileExists, safeReadText } from "./fs-utils.js";
import type { AxiConfig } from "./types.js";

const DEFAULT_CONFIG: AxiConfig = {
  serve: {
    host: "127.0.0.1",
    port: 8787,
    api_token: ""
  },
  query: {
    max_tokens_default: 4000
  }
};

function parseTomlSections(raw: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let currentSection = "root";
  sections[currentSection] = {};
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const sectionMatch = trimmed.match(/^\[(.+)]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      sections[currentSection] ??= {};
      continue;
    }

    const keyValueMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!keyValueMatch) {
      continue;
    }

    const key = keyValueMatch[1].trim();
    let value = keyValueMatch[2].trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    sections[currentSection][key] = value;
  }

  return sections;
}

function parseNumber(input: string | undefined, fallback: number): number {
  if (!input) {
    return fallback;
  }
  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function loadAxiConfig(repoPath: string): Promise<AxiConfig> {
  const configPath = path.join(repoPath, ".axicontext", "config.toml");
  if (!(await fileExists(configPath))) {
    return DEFAULT_CONFIG;
  }

  const raw = await safeReadText(configPath);
  const sections = parseTomlSections(raw);
  const serve = sections.serve ?? {};
  const query = sections.query ?? {};

  return {
    serve: {
      host: serve.host ?? DEFAULT_CONFIG.serve.host,
      port: parseNumber(serve.port, DEFAULT_CONFIG.serve.port),
      api_token: serve.api_token ?? DEFAULT_CONFIG.serve.api_token
    },
    query: {
      max_tokens_default: parseNumber(
        query.max_tokens_default,
        DEFAULT_CONFIG.query.max_tokens_default
      )
    }
  };
}
