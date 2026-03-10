import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BundleOptions, BundleResult, JsonObject, OutputFormat } from './types';
import { BundlerError } from './errors';
import { collectInputFiles } from './collect-inputs';
import { loadDocument } from './loader';
import { mergeRoots } from './merge';
import { dereferenceDocument } from './resolver';
import { normalizeDocument } from './normalize';
import { validateDocument } from './validate';
import { emitDocument } from './emit';

const DEFAULT_OPTIONS: BundleOptions = {
  outputFormat: 'yaml',
  validate: 'basic',
  failOnWarning: false,
  maxDepth: 200,
  debugResolver: false,
};

export function inferOutputFormat(outputPath: string): OutputFormat {
  const extension = path.extname(outputPath).toLowerCase();
  if (extension === '.yaml' || extension === '.yml') {
    return 'yaml';
  }
  if (extension === '.json') {
    return 'json';
  }

  throw new BundlerError(
    'CANNOT_INFER_FORMAT',
    'Cannot infer output format from extension. Use --format yaml|json.',
    { outputPath }
  );
}

export async function bundleDocuments(
  patterns: string[],
  cwd: string,
  options?: Partial<BundleOptions>
): Promise<BundleResult> {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
  const inputFiles = await collectInputFiles(patterns, cwd);

  const loadedRoots: JsonObject[] = [];
  for (const input of inputFiles) {
    const loaded = await loadDocument(input.absolutePath);
    loadedRoots.push(loaded.document);
  }

  const merged = mergeRoots(loadedRoots);
  const virtualRootPath = inputFiles[0].absolutePath;
  const dereferenced = await dereferenceDocument(merged, virtualRootPath, {
    maxDepth: mergedOptions.maxDepth,
    debugResolver: mergedOptions.debugResolver,
  });
  const { warnings } = normalizeDocument(dereferenced);

  if (mergedOptions.failOnWarning && warnings.length > 0) {
    throw new BundlerError('WARNINGS_PRESENT', 'Warnings found while bundling', {
      warnings: warnings.join('; '),
    });
  }

  validateDocument(dereferenced, mergedOptions.validate);
  return { document: dereferenced, warnings };
}

export async function bundleToFile(
  patterns: string[],
  outputPath: string,
  cwd: string,
  options?: Partial<BundleOptions>
): Promise<BundleResult> {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
  const result = await bundleDocuments(patterns, cwd, mergedOptions);
  const output = emitDocument(result.document, mergedOptions.outputFormat);
  await writeFile(outputPath, output, 'utf8');
  return result;
}

export async function readBundledOutput(filePath: string): Promise<string> {
  return readFile(filePath, 'utf8');
}
