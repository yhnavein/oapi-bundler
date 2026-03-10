import { access } from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'tinyglobby';
import { BundlerError } from './errors';
import type { InputFile } from './types';
import { toCanonicalPath } from '../utils/path';

async function isFilePath(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

export async function collectInputFiles(
  patterns: string[],
  cwd: string
): Promise<InputFile[]> {
  if (patterns.length === 0) {
    throw new BundlerError('NO_INPUTS', 'At least one input path or glob is required');
  }

  const canonicalToDisplay = new Map<string, string>();

  for (const pattern of patterns) {
    const resolvedPattern = path.resolve(cwd, pattern);
    const matches = (await isFilePath(resolvedPattern))
      ? [resolvedPattern]
      : await glob(pattern, {
          cwd,
          onlyFiles: true,
          absolute: true,
        });

    for (const match of matches) {
      const canonical = await toCanonicalPath(match);
      canonicalToDisplay.set(canonical, path.relative(cwd, match) || '.');
    }
  }

  if (canonicalToDisplay.size === 0) {
    throw new BundlerError('NO_MATCHES', 'Input patterns did not match any files');
  }

  return [...canonicalToDisplay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([absolutePath, displayPath]) => ({ absolutePath, displayPath }));
}
