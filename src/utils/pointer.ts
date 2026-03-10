import { BundlerError } from '../core/errors';

export function decodeJsonPointerToken(token: string): string {
  return token.replaceAll('~1', '/').replaceAll('~0', '~');
}

export function parseJsonPointer(pointer: string): string[] {
  if (pointer === '' || pointer === '#') {
    return [];
  }

  const normalized = pointer.startsWith('#') ? pointer.slice(1) : pointer;

  if (!normalized.startsWith('/')) {
    throw new BundlerError('INVALID_POINTER', `Invalid JSON pointer: ${pointer}`);
  }

  return normalized
    .slice(1)
    .split('/')
    .map((segment) => decodeJsonPointerToken(segment));
}

export function getValueAtPointer(root: unknown, pointer: string): unknown {
  const segments = parseJsonPointer(pointer);
  let current: unknown = root;

  for (const segment of segments) {
    if (typeof current !== 'object' || current === null) {
      throw new BundlerError(
        'POINTER_NOT_FOUND',
        `Pointer segment not found: ${segment}`,
        { pointer }
      );
    }

    if (!(segment in current)) {
      throw new BundlerError(
        'POINTER_NOT_FOUND',
        `Pointer segment not found: ${segment}`,
        { pointer }
      );
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}
