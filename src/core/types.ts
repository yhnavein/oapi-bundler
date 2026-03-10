export type JsonObject = Record<string, unknown>;

export type OutputFormat = 'yaml' | 'json';

export type ValidationMode = 'basic' | 'strict';

export interface BundleOptions {
  outputFormat: OutputFormat;
  validate: ValidationMode;
  failOnWarning: boolean;
  maxDepth: number;
  debugResolver: boolean;
}

export interface InputFile {
  absolutePath: string;
  displayPath: string;
}

export interface LoadedDocument {
  filePath: string;
  document: JsonObject;
}

export interface ResolverContext {
  filePath: string;
  pointer: string;
}

export interface BundleResult {
  document: JsonObject;
  warnings: string[];
}
