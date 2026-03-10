import YAML from 'yaml';
import type { JsonObject, OutputFormat } from './types';

const TOP_LEVEL_ORDER = [
  'openapi',
  'info',
  'servers',
  'security',
  'paths',
  'components',
];

function sortValue(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item, depth + 1));
  }

  if (typeof value !== 'object' || value === null) {
    return value;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const sortedEntries =
    depth === 0
      ? [
          ...TOP_LEVEL_ORDER.filter((key) => key in (value as Record<string, unknown>)).map(
            (key) => [key, (value as Record<string, unknown>)[key]] as const
          ),
          ...entries
            .filter(([key]) => !TOP_LEVEL_ORDER.includes(key))
            .sort(([a], [b]) => a.localeCompare(b)),
        ]
      : entries.sort(([a], [b]) => a.localeCompare(b));

  return Object.fromEntries(
    sortedEntries.map(([key, nested]) => [key, sortValue(nested, depth + 1)])
  );
}

export function emitDocument(document: JsonObject, format: OutputFormat): string {
  const normalizedDocument = sortValue(document);

  if (format === 'json') {
    return `${JSON.stringify(normalizedDocument, null, 2)}\n`;
  }

  return YAML.stringify(normalizedDocument);
}
