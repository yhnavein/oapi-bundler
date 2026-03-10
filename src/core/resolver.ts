import path from 'node:path';
import { loadDocument } from './loader';
import type { JsonObject } from './types';
import { BundlerError } from './errors';
import { getValueAtPointer } from '../utils/pointer';
import { toCanonicalPath } from '../utils/path';

interface ResolveOptions {
  maxDepth: number;
  debugResolver: boolean;
}

interface RefTarget {
  targetPath: string;
  targetPointer: string;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function splitRef(ref: string, baseFile: string): RefTarget {
  const [filePart, fragmentPart] = ref.split('#', 2);
  const targetPointer = fragmentPart ? `#${fragmentPart}` : '#';

  if (!filePart) {
    return {
      targetPath: baseFile,
      targetPointer,
    };
  }

  return {
    targetPath: path.resolve(path.dirname(baseFile), filePart),
    targetPointer,
  };
}

function mergeRefWithSiblings(
  resolved: unknown,
  node: Record<string, unknown>
): unknown {
  const siblings = Object.fromEntries(
    Object.entries(node).filter(([key]) => key !== '$ref')
  );

  if (Object.keys(siblings).length === 0) {
    return resolved;
  }

  if (typeof resolved === 'object' && resolved !== null && !Array.isArray(resolved)) {
    return {
      ...(resolved as Record<string, unknown>),
      ...siblings,
    };
  }

  return resolved;
}

export async function dereferenceDocument(
  rootDocument: JsonObject,
  rootFilePath: string,
  options: ResolveOptions
): Promise<JsonObject> {
  const fileCache = new Map<string, JsonObject>();
  const nodeCache = new Map<string, unknown>();
  const visiting = new Set<string>();

  const canonicalRootPath = await toCanonicalPath(rootFilePath);
  fileCache.set(canonicalRootPath, rootDocument);

  async function getFileDocument(filePath: string): Promise<JsonObject> {
    const canonicalPath = await toCanonicalPath(filePath);
    const cached = fileCache.get(canonicalPath);
    if (cached) {
      return cached;
    }

    const loaded = await loadDocument(canonicalPath);
    fileCache.set(canonicalPath, loaded.document);
    return loaded.document;
  }

  async function resolveValue(
    value: unknown,
    currentFilePath: string,
    pointer: string,
    depth: number,
    chain: string[]
  ): Promise<unknown> {
    if (depth > options.maxDepth) {
      throw new BundlerError('MAX_DEPTH_EXCEEDED', 'Resolver max depth exceeded', {
        pointer,
        depth: String(depth),
      });
    }

    if (Array.isArray(value)) {
      const nextValues = await Promise.all(
        value.map((item, index) =>
          resolveValue(item, currentFilePath, `${pointer}/${index}`, depth + 1, chain)
        )
      );
      return nextValues;
    }

    if (typeof value !== 'object' || value === null) {
      return value;
    }

    const typedValue = value as Record<string, unknown>;
    if (typeof typedValue.$ref === 'string') {
      const ref = typedValue.$ref;
      const { targetPath, targetPointer } = splitRef(ref, currentFilePath);
      const canonicalTargetPath = await toCanonicalPath(targetPath);
      const targetKey = `${canonicalTargetPath}${targetPointer}`;

      if (options.debugResolver) {
        process.stderr.write(
          `[resolver] ${currentFilePath}${pointer} -> ${targetKey}\n`
        );
      }

      if (nodeCache.has(targetKey)) {
        return mergeRefWithSiblings(clone(nodeCache.get(targetKey)), typedValue);
      }

      if (visiting.has(targetKey)) {
        throw new BundlerError('REF_CYCLE', 'Circular $ref detected', {
          chain: [...chain, targetKey].join(' -> '),
        });
      }

      visiting.add(targetKey);
      const targetDocument = await getFileDocument(canonicalTargetPath);
      const targetValue = getValueAtPointer(targetDocument, targetPointer);
      const nextChain = [...chain, targetKey];
      const resolvedTargetValue = await resolveValue(
        targetValue,
        canonicalTargetPath,
        targetPointer,
        depth + 1,
        nextChain
      );
      visiting.delete(targetKey);
      nodeCache.set(targetKey, clone(resolvedTargetValue));

      return mergeRefWithSiblings(clone(resolvedTargetValue), typedValue);
    }

    const next: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(typedValue)) {
      next[key] = await resolveValue(
        nestedValue,
        currentFilePath,
        `${pointer}/${key}`,
        depth + 1,
        chain
      );
    }
    return next;
  }

  const resolvedRoot = await resolveValue(
    rootDocument,
    canonicalRootPath,
    '#',
    0,
    []
  );

  return resolvedRoot as JsonObject;
}
