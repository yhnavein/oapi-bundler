import path from 'node:path';
import { BundlerError } from './errors';
import { loadDocument } from './loader';
import type { JsonObject, SchemaReuseMode } from './types';
import { toCanonicalPath } from '../utils/path';
import { getValueAtPointer } from '../utils/pointer';

interface ResolveOptions {
  maxDepth: number;
  debugResolver: boolean;
  schemaReuse: SchemaReuseMode;
}

interface RefTarget {
  targetPath: string;
  targetPointer: string;
}

interface SchemaTarget {
  key: string;
  filePath: string;
  pointer: string;
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

function isSchemaPointer(pointer: string): boolean {
  return pointer.startsWith('#/components/schemas/');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeSchemaName(name: string): string {
  return name.replaceAll(/[^A-Za-z0-9_\-.]/g, '_') || 'Schema';
}

function detectCycleNodes(edges: Map<string, Set<string>>): Set<string> {
  const states = new Map<string, 'new' | 'visiting' | 'done'>();
  const stack: string[] = [];
  const cycles = new Set<string>();

  const visit = (node: string): void => {
    const state = states.get(node) ?? 'new';
    if (state === 'done') {
      return;
    }
    if (state === 'visiting') {
      const index = stack.lastIndexOf(node);
      const cycleSlice = index >= 0 ? stack.slice(index) : [node];
      for (const cycleNode of cycleSlice) {
        cycles.add(cycleNode);
      }
      cycles.add(node);
      return;
    }

    states.set(node, 'visiting');
    stack.push(node);
    for (const next of edges.get(node) ?? []) {
      visit(next);
    }
    stack.pop();
    states.set(node, 'done');
  };

  for (const node of edges.keys()) {
    visit(node);
  }

  return cycles;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }
  if (!isPlainObject(value)) {
    return JSON.stringify(value);
  }

  const parts = Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableSerialize(nested)}`);
  return `{${parts.join(',')}}`;
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

  if (isPlainObject(resolved)) {
    return {
      ...resolved,
      ...siblings,
    };
  }

  return resolved;
}

function splitSchemaKey(schemaKey: string): { filePath: string; pointer: string } {
  const hashIndex = schemaKey.indexOf('#');
  if (hashIndex === -1) {
    return { filePath: schemaKey, pointer: '#' };
  }
  return {
    filePath: schemaKey.slice(0, hashIndex),
    pointer: schemaKey.slice(hashIndex),
  };
}

export async function dereferenceDocument(
  rootDocument: JsonObject,
  rootFilePath: string,
  options: ResolveOptions
): Promise<JsonObject> {
  const fileCache = new Map<string, JsonObject>();
  const schemaTargets = new Map<string, SchemaTarget>();
  const schemaUsage = new Map<string, number>();
  const schemaEdges = new Map<string, Set<string>>();
  const analyzedSchemaKeys = new Set<string>();
  const analyzingSchemaKeys = new Set<string>();

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

  async function resolveTarget(
    ref: string,
    currentFilePath: string
  ): Promise<SchemaTarget> {
    const { targetPath, targetPointer } = splitRef(ref, currentFilePath);
    const canonicalTargetPath = await toCanonicalPath(targetPath);
    return {
      key: `${canonicalTargetPath}${targetPointer}`,
      filePath: canonicalTargetPath,
      pointer: targetPointer,
    };
  }

  async function analyzeSchema(schemaKey: string, depth: number): Promise<void> {
    if (depth > options.maxDepth) {
      throw new BundlerError('MAX_DEPTH_EXCEEDED', 'Resolver max depth exceeded', {
        depth: String(depth),
        schemaKey,
      });
    }

    if (analyzedSchemaKeys.has(schemaKey) || analyzingSchemaKeys.has(schemaKey)) {
      return;
    }

    analyzingSchemaKeys.add(schemaKey);
    const target = schemaTargets.get(schemaKey);
    if (!target) {
      throw new BundlerError('SCHEMA_TARGET_NOT_FOUND', 'Schema target missing');
    }

    const targetDocument = await getFileDocument(target.filePath);
    const targetValue = getValueAtPointer(targetDocument, target.pointer);
    await analyzeValue(targetValue, target.filePath, target.pointer, depth + 1, schemaKey);

    analyzingSchemaKeys.delete(schemaKey);
    analyzedSchemaKeys.add(schemaKey);
  }

  async function analyzeValue(
    value: unknown,
    currentFilePath: string,
    pointer: string,
    depth: number,
    currentSchemaKey?: string
  ): Promise<void> {
    if (depth > options.maxDepth) {
      throw new BundlerError('MAX_DEPTH_EXCEEDED', 'Resolver max depth exceeded', {
        pointer,
        depth: String(depth),
      });
    }

    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        await analyzeValue(
          value[index],
          currentFilePath,
          `${pointer}/${index}`,
          depth + 1,
          currentSchemaKey
        );
      }
      return;
    }

    if (!isPlainObject(value)) {
      return;
    }

    if (typeof value.$ref === 'string') {
      const target = await resolveTarget(value.$ref, currentFilePath);

      if (options.debugResolver) {
        process.stderr.write(`[resolver] ${currentFilePath}${pointer} -> ${target.key}\n`);
      }

      if (isSchemaPointer(target.pointer)) {
        schemaTargets.set(target.key, target);
        schemaUsage.set(target.key, (schemaUsage.get(target.key) ?? 0) + 1);
        if (currentSchemaKey) {
          const nextEdges = schemaEdges.get(currentSchemaKey) ?? new Set<string>();
          nextEdges.add(target.key);
          schemaEdges.set(currentSchemaKey, nextEdges);
        }
        await analyzeSchema(target.key, depth + 1);
      } else {
        const targetDocument = await getFileDocument(target.filePath);
        const targetValue = getValueAtPointer(targetDocument, target.pointer);
        await analyzeValue(
          targetValue,
          target.filePath,
          target.pointer,
          depth + 1,
          currentSchemaKey
        );
      }

      for (const [key, sibling] of Object.entries(value)) {
        if (key === '$ref') {
          continue;
        }
        await analyzeValue(
          sibling,
          currentFilePath,
          `${pointer}/${key}`,
          depth + 1,
          currentSchemaKey
        );
      }
      return;
    }

    for (const [key, nested] of Object.entries(value)) {
      await analyzeValue(
        nested,
        currentFilePath,
        `${pointer}/${key}`,
        depth + 1,
        currentSchemaKey
      );
    }
  }

  await analyzeValue(rootDocument, canonicalRootPath, '#', 0);

  const cycleNodes = detectCycleNodes(schemaEdges);
  const hoistedSchemaKeys = new Set<string>();

  for (const [schemaKey, usage] of schemaUsage.entries()) {
    if (options.schemaReuse === 'aggressive') {
      hoistedSchemaKeys.add(schemaKey);
      continue;
    }

    if (options.schemaReuse === 'minimal') {
      if (cycleNodes.has(schemaKey)) {
        hoistedSchemaKeys.add(schemaKey);
      }
      continue;
    }

    if (cycleNodes.has(schemaKey) || usage > 1) {
      hoistedSchemaKeys.add(schemaKey);
    }
  }

  const reservedNames = new Set<string>();
  const existingSchemas =
    isPlainObject(rootDocument.components) &&
    isPlainObject((rootDocument.components as JsonObject).schemas)
      ? ((rootDocument.components as JsonObject).schemas as JsonObject)
      : {};

  for (const existingName of Object.keys(existingSchemas)) {
    reservedNames.add(existingName);
  }

  const schemaNameByKey = new Map<string, string>();
  for (const schemaKey of [...hoistedSchemaKeys].sort((a, b) => a.localeCompare(b))) {
    const target = schemaTargets.get(schemaKey);
    if (!target) {
      continue;
    }

    const pointerSegments = target.pointer.split('/');
    const baseName = sanitizeSchemaName(
      pointerSegments[pointerSegments.length - 1] ?? 'Schema'
    );
    let candidate = baseName;
    let suffix = 2;

    while (reservedNames.has(candidate)) {
      const rootSchemaKey = `${canonicalRootPath}#/components/schemas/${candidate}`;
      if (rootSchemaKey === schemaKey) {
        break;
      }
      candidate = `${baseName}_${suffix}`;
      suffix += 1;
    }

    reservedNames.add(candidate);
    schemaNameByKey.set(schemaKey, candidate);
  }

  async function resolveValue(
    value: unknown,
    currentFilePath: string,
    pointer: string,
    depth: number,
    materializingSchemas: Set<string>
  ): Promise<unknown> {
    if (depth > options.maxDepth) {
      throw new BundlerError('MAX_DEPTH_EXCEEDED', 'Resolver max depth exceeded', {
        pointer,
        depth: String(depth),
      });
    }

    if (Array.isArray(value)) {
      const nextValues: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        nextValues.push(
          await resolveValue(
            value[index],
            currentFilePath,
            `${pointer}/${index}`,
            depth + 1,
            materializingSchemas
          )
        );
      }
      return nextValues;
    }

    if (!isPlainObject(value)) {
      return value;
    }

    if (typeof value.$ref === 'string') {
      const target = await resolveTarget(value.$ref, currentFilePath);

      if (isSchemaPointer(target.pointer)) {
        const schemaName = schemaNameByKey.get(target.key);
        const siblingsResolved = await resolveSiblings(
          value,
          currentFilePath,
          pointer,
          depth,
          materializingSchemas
        );

        if (hoistedSchemaKeys.has(target.key) || materializingSchemas.has(target.key)) {
          return {
            $ref: `#/components/schemas/${schemaName ?? 'Schema'}`,
            ...siblingsResolved,
          };
        }

        const targetDocument = await getFileDocument(target.filePath);
        const targetValue = getValueAtPointer(targetDocument, target.pointer);
        const resolvedInline = await resolveValue(
          targetValue,
          target.filePath,
          target.pointer,
          depth + 1,
          materializingSchemas
        );
        return mergeRefWithSiblings(resolvedInline, {
          ...value,
          ...siblingsResolved,
        });
      }

      const targetDocument = await getFileDocument(target.filePath);
      const targetValue = getValueAtPointer(targetDocument, target.pointer);
      const resolvedTargetValue = await resolveValue(
        targetValue,
        target.filePath,
        target.pointer,
        depth + 1,
        materializingSchemas
      );
      return mergeRefWithSiblings(resolvedTargetValue, value);
    }

    const next: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      next[key] = await resolveValue(
        nested,
        currentFilePath,
        `${pointer}/${key}`,
        depth + 1,
        materializingSchemas
      );
    }
    return next;
  }

  async function resolveSiblings(
    value: Record<string, unknown>,
    currentFilePath: string,
    pointer: string,
    depth: number,
    materializingSchemas: Set<string>
  ): Promise<Record<string, unknown>> {
    const siblings: Record<string, unknown> = {};
    for (const [key, sibling] of Object.entries(value)) {
      if (key === '$ref') {
        continue;
      }
      siblings[key] = await resolveValue(
        sibling,
        currentFilePath,
        `${pointer}/${key}`,
        depth + 1,
        materializingSchemas
      );
    }
    return siblings;
  }

  const resolvedRoot = (await resolveValue(
    rootDocument,
    canonicalRootPath,
    '#',
    0,
    new Set()
  )) as JsonObject;

  const hoistedSchemas: JsonObject = {};
  for (const schemaKey of [...hoistedSchemaKeys].sort((a, b) => a.localeCompare(b))) {
    const schemaName = schemaNameByKey.get(schemaKey);
    if (!schemaName) {
      continue;
    }

    const target = schemaTargets.get(schemaKey);
    if (!target) {
      continue;
    }

    const targetDocument = await getFileDocument(target.filePath);
    const targetValue = getValueAtPointer(targetDocument, target.pointer);
    const materializingSchemas = new Set<string>([schemaKey]);
    hoistedSchemas[schemaName] = await resolveValue(
      targetValue,
      target.filePath,
      target.pointer,
      0,
      materializingSchemas
    );
  }

  const schemaAlias = new Map<string, string>();
  if (options.schemaReuse === 'aggressive') {
    const keysByFingerprint = new Map<string, string>();
    for (const [schemaName, schemaValue] of Object.entries(hoistedSchemas)) {
      const fingerprint = stableSerialize(schemaValue);
      const existingName = keysByFingerprint.get(fingerprint);
      if (!existingName) {
        keysByFingerprint.set(fingerprint, schemaName);
        continue;
      }

      schemaAlias.set(schemaName, existingName);
      delete hoistedSchemas[schemaName];
    }
  }

  function rewriteSchemaRefs(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => rewriteSchemaRefs(item));
    }
    if (!isPlainObject(value)) {
      return value;
    }

    const next: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (key === '$ref' && typeof nested === 'string') {
        const prefix = '#/components/schemas/';
        if (nested.startsWith(prefix)) {
          const schemaName = nested.slice(prefix.length);
          const alias = schemaAlias.get(schemaName);
          next[key] = alias ? `${prefix}${alias}` : nested;
          continue;
        }
      }

      next[key] = rewriteSchemaRefs(nested);
    }
    return next;
  }

  const rewrittenRoot = rewriteSchemaRefs(resolvedRoot) as JsonObject;
  const rewrittenHoistedSchemas = rewriteSchemaRefs(hoistedSchemas) as JsonObject;

  const components = isPlainObject(rewrittenRoot.components)
    ? (rewrittenRoot.components as JsonObject)
    : {};
  const schemas = isPlainObject(components.schemas)
    ? (components.schemas as JsonObject)
    : {};

  rewrittenRoot.components = {
    ...components,
    schemas: {
      ...schemas,
      ...rewrittenHoistedSchemas,
    },
  };

  return rewrittenRoot;
}
