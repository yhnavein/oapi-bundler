import { BundlerError } from './errors';
import type { JsonObject, ValidationMode } from './types';

export function validateDocument(document: JsonObject, mode: ValidationMode): void {
  const openapi = document.openapi;
  if (typeof openapi !== 'string' || !openapi.startsWith('3.')) {
    throw new BundlerError('INVALID_OPENAPI_VERSION', 'OpenAPI version must be 3.x');
  }

  if (typeof document.info !== 'object' || document.info === null) {
    throw new BundlerError('INVALID_INFO', 'OpenAPI document must include an info object');
  }

  if (typeof document.paths !== 'object' || document.paths === null) {
    throw new BundlerError('INVALID_PATHS', 'OpenAPI document must include a paths object');
  }

  if (mode === 'strict') {
    const operationIds = new Set<string>();
    for (const pathItemValue of Object.values(document.paths as JsonObject)) {
      if (typeof pathItemValue !== 'object' || pathItemValue === null) {
        continue;
      }

      for (const operationValue of Object.values(pathItemValue as JsonObject)) {
        if (typeof operationValue !== 'object' || operationValue === null) {
          continue;
        }

        const operationId = (operationValue as JsonObject).operationId;
        if (typeof operationId !== 'string') {
          continue;
        }

        if (operationIds.has(operationId)) {
          throw new BundlerError(
            'DUPLICATE_OPERATION_ID',
            `Duplicate operationId found: ${operationId}`
          );
        }
        operationIds.add(operationId);
      }
    }
  }
}
