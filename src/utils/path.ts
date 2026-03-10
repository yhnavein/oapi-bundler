import path from 'node:path';
import { realpath } from 'node:fs/promises';

export async function toCanonicalPath(filePath: string): Promise<string> {
  const absolutePath = path.resolve(filePath);
  const resolvedPath = await realpath(absolutePath);
  return normalizePathSeparators(resolvedPath);
}

export function normalizePathSeparators(filePath: string): string {
  return filePath.split(path.sep).join('/');
}
