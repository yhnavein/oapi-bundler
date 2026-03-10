import { BundlerError } from './errors';
import type { JsonObject } from './types';

const OPERATION_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const;

function ensurePathParametersRequired(parameters: unknown): void {
  if (!Array.isArray(parameters)) {
    return;
  }

  for (const parameter of parameters) {
    if (typeof parameter !== 'object' || parameter === null) {
      continue;
    }
    const typedParameter = parameter as Record<string, unknown>;
    if (typedParameter.in === 'path') {
      typedParameter.required = true;
    }
  }
}

function extractTemplateParams(pathTemplate: string): Set<string> {
  const matches = [...pathTemplate.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
  return new Set(matches);
}

function collectParameterNames(parameters: unknown): Set<string> {
  if (!Array.isArray(parameters)) {
    return new Set();
  }

  const names = new Set<string>();
  for (const parameter of parameters) {
    if (
      typeof parameter === 'object' &&
      parameter !== null &&
      (parameter as Record<string, unknown>).in === 'path' &&
      typeof (parameter as Record<string, unknown>).name === 'string'
    ) {
      names.add((parameter as Record<string, unknown>).name as string);
    }
  }
  return names;
}

export function normalizeDocument(document: JsonObject): { warnings: string[] } {
  const warnings: string[] = [];
  const paths = document.paths;
  if (typeof paths !== 'object' || paths === null) {
    return { warnings };
  }

  for (const [pathTemplate, pathItemValue] of Object.entries(paths as JsonObject)) {
    if (typeof pathItemValue !== 'object' || pathItemValue === null) {
      continue;
    }

    const pathItem = pathItemValue as JsonObject;
    ensurePathParametersRequired(pathItem.parameters);

    const templateParams = extractTemplateParams(pathTemplate);
    if (templateParams.size === 0) {
      continue;
    }

    const pathLevelParams = collectParameterNames(pathItem.parameters);

    for (const method of OPERATION_METHODS) {
      const operationValue = pathItem[method];
      if (typeof operationValue !== 'object' || operationValue === null) {
        continue;
      }

      const operation = operationValue as JsonObject;
      ensurePathParametersRequired(operation.parameters);
      const operationParams = collectParameterNames(operation.parameters);
      const availableParams = new Set([...pathLevelParams, ...operationParams]);

      for (const paramName of templateParams) {
        if (!availableParams.has(paramName)) {
          throw new BundlerError(
            'MISSING_PATH_PARAM',
            `Path template parameter '{${paramName}}' is not defined`,
            { path: pathTemplate, method: method.toUpperCase() }
          );
        }
      }
    }
  }

  return { warnings };
}
