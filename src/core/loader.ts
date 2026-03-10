import { readFile } from 'node:fs/promises';
import YAML from 'yaml';
import { BundlerError } from './errors';
import type { JsonObject, LoadedDocument } from './types';

function parseDocument(raw: string, filePath: string): JsonObject {
  const lowerFilePath = filePath.toLowerCase();
  const parseAsJson = lowerFilePath.endsWith('.json');

  try {
    const parsed = parseAsJson ? JSON.parse(raw) : YAML.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new BundlerError('INVALID_DOCUMENT', 'OpenAPI root must be an object', {
        filePath,
      });
    }
    return parsed as JsonObject;
  } catch (error) {
    throw new BundlerError('PARSE_ERROR', 'Failed to parse input file', {
      filePath,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function loadDocument(filePath: string): Promise<LoadedDocument> {
  const raw = await readFile(filePath, 'utf8');
  return {
    filePath,
    document: parseDocument(raw, filePath),
  };
}
