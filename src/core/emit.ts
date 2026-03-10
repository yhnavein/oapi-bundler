import YAML from 'yaml';
import type { JsonObject, OutputFormat } from './types';

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }

  if (typeof value !== 'object' || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, sortValue(nested)])
  );
}

export function emitDocument(document: JsonObject, format: OutputFormat): string {
  const normalizedDocument = sortValue(document);

  if (format === 'json') {
    return `${JSON.stringify(normalizedDocument, null, 2)}\n`;
  }

  return YAML.stringify(normalizedDocument);
}
