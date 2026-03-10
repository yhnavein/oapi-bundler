import { BundlerError } from './errors';
import type { JsonObject } from './types';

const OPERATION_METHODS = new Set([
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
]);

function clone<T>(value: T): T {
  return structuredClone(value);
}

function areEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function mergeArrayUnique(
  target: unknown[],
  incoming: unknown[],
  keyFn: (value: unknown) => string
): unknown[] {
  const map = new Map(target.map((value) => [keyFn(value), value]));
  for (const value of incoming) {
    const key = keyFn(value);
    if (!map.has(key)) {
      map.set(key, value);
    }
  }
  return [...map.values()];
}

function mergePathObject(
  pathKey: string,
  targetPathObj: JsonObject,
  incomingPathObj: JsonObject
): JsonObject {
  const merged = clone(targetPathObj);

  for (const [key, value] of Object.entries(incomingPathObj)) {
    if (key === 'parameters') {
      const existing = (merged.parameters as unknown[] | undefined) ?? [];
      const incoming = (value as unknown[] | undefined) ?? [];
      merged.parameters = mergeArrayUnique(existing, incoming, (parameter) => {
        if (
          typeof parameter === 'object' &&
          parameter !== null &&
          'name' in parameter &&
          'in' in parameter
        ) {
          const typed = parameter as Record<string, unknown>;
          return `${typed.in}:${typed.name}`;
        }
        return JSON.stringify(parameter);
      });
      continue;
    }

    if (OPERATION_METHODS.has(key)) {
      if (key in merged && !areEqual(merged[key], value)) {
        throw new BundlerError(
          'PATH_CONFLICT',
          `Conflicting operation for ${key.toUpperCase()} ${pathKey}`
        );
      }
      merged[key] = clone(value);
      continue;
    }

    if (key in merged && !areEqual(merged[key], value)) {
      throw new BundlerError(
        'PATH_CONFLICT',
        `Conflicting path-level key '${key}' for path '${pathKey}'`
      );
    }
    merged[key] = clone(value);
  }

  return merged;
}

function mergePaths(target: JsonObject, incoming: JsonObject): JsonObject {
  const merged = clone(target);
  for (const [pathKey, pathValue] of Object.entries(incoming)) {
    if (typeof pathValue !== 'object' || pathValue === null) {
      throw new BundlerError('INVALID_PATH_ITEM', `Path item must be an object: ${pathKey}`);
    }

    if (!(pathKey in merged)) {
      merged[pathKey] = clone(pathValue);
      continue;
    }

    merged[pathKey] = mergePathObject(
      pathKey,
      merged[pathKey] as JsonObject,
      pathValue as JsonObject
    );
  }
  return merged;
}

function mergeComponents(target: JsonObject, incoming: JsonObject): JsonObject {
  const merged = clone(target);

  for (const [sectionName, sectionValue] of Object.entries(incoming)) {
    if (typeof sectionValue !== 'object' || sectionValue === null) {
      throw new BundlerError(
        'INVALID_COMPONENT_SECTION',
        `Component section must be object: ${sectionName}`
      );
    }

    const existingSection = (merged[sectionName] as JsonObject | undefined) ?? {};
    const nextSection: JsonObject = clone(existingSection);

    for (const [componentName, componentValue] of Object.entries(
      sectionValue as JsonObject
    )) {
      if (
        componentName in nextSection &&
        !areEqual(nextSection[componentName], componentValue)
      ) {
        throw new BundlerError(
          'COMPONENT_CONFLICT',
          `Conflicting component '${sectionName}.${componentName}'`
        );
      }
      nextSection[componentName] = clone(componentValue);
    }

    merged[sectionName] = nextSection;
  }

  return merged;
}

function mergeTopLevelArray(
  target: unknown,
  incoming: unknown,
  dedupeKey: (value: unknown) => string
): unknown[] {
  const targetArray = Array.isArray(target) ? target : [];
  const incomingArray = Array.isArray(incoming) ? incoming : [];
  return mergeArrayUnique(targetArray, incomingArray, dedupeKey);
}

export function mergeRoots(roots: JsonObject[]): JsonObject {
  if (roots.length === 0) {
    throw new BundlerError('NO_ROOTS', 'No OpenAPI roots to merge');
  }

  const [firstRoot, ...restRoots] = roots;
  const mergedRoot: JsonObject = clone(firstRoot);

  for (const root of restRoots) {
    for (const [key, value] of Object.entries(root)) {
      if (key === 'openapi') {
        if (mergedRoot.openapi !== value) {
          throw new BundlerError('OPENAPI_VERSION_CONFLICT', 'OpenAPI versions conflict');
        }
        continue;
      }

      if (key === 'info') {
        continue;
      }

      if (key === 'servers') {
        mergedRoot.servers = mergeTopLevelArray(mergedRoot.servers, value, (server) => {
          if (typeof server === 'object' && server !== null && 'url' in server) {
            return String((server as Record<string, unknown>).url);
          }
          return JSON.stringify(server);
        });
        continue;
      }

      if (key === 'tags') {
        mergedRoot.tags = mergeTopLevelArray(mergedRoot.tags, value, (tag) => {
          if (typeof tag === 'object' && tag !== null && 'name' in tag) {
            return String((tag as Record<string, unknown>).name);
          }
          return JSON.stringify(tag);
        });
        continue;
      }

      if (key === 'security') {
        mergedRoot.security = mergeTopLevelArray(
          mergedRoot.security,
          value,
          (securityItem) => JSON.stringify(securityItem)
        );
        continue;
      }

      if (key === 'paths') {
        mergedRoot.paths = mergePaths(
          (mergedRoot.paths as JsonObject | undefined) ?? {},
          (value as JsonObject | undefined) ?? {}
        );
        continue;
      }

      if (key === 'components') {
        mergedRoot.components = mergeComponents(
          (mergedRoot.components as JsonObject | undefined) ?? {},
          (value as JsonObject | undefined) ?? {}
        );
        continue;
      }

      if (key in mergedRoot && !areEqual(mergedRoot[key], value)) {
        throw new BundlerError(
          'ROOT_CONFLICT',
          `Conflicting top-level key '${key}' while merging roots`
        );
      }

      mergedRoot[key] = clone(value);
    }
  }

  return mergedRoot;
}
