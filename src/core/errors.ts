export class BundlerError extends Error {
  public readonly code: string;

  public readonly details?: Record<string, string>;

  public constructor(code: string, message: string, details?: Record<string, string>) {
    super(message);
    this.name = 'BundlerError';
    this.code = code;
    this.details = details;
  }
}

export function formatError(error: unknown): string {
  if (error instanceof BundlerError) {
    const details = error.details
      ? ` (${Object.entries(error.details)
          .map(([key, value]) => `${key}: ${value}`)
          .join(', ')})`
      : '';
    return `[${error.code}] ${error.message}${details}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
