#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { Command } from 'commander';
import { blue, green, red, yellow } from 'nanocolors';
import { bundleToFile, inferOutputFormat } from './core/bundle';
import { formatError } from './core/errors';
import type { OutputFormat, ValidationMode } from './core/types';

interface CliOptions {
  output: string;
  format?: OutputFormat;
  validate: ValidationMode;
  failOnWarning: boolean;
  maxDepth: string;
  debugResolver: boolean;
}

const program = new Command();

program
  .name('oapi-bundler')
  .description('Merge modular OpenAPI files into one dereferenced document')
  .argument('<inputs...>', 'Input files or glob patterns')
  .requiredOption('-o, --output <file>', 'Output file path')
  .option('--format <yaml|json>', 'Output format (inferred from output extension by default)')
  .option('--validate <basic|strict>', 'Validation mode', 'basic')
  .option('--fail-on-warning', 'Fail if warnings are produced', false)
  .option('--max-depth <n>', 'Maximum resolver traversal depth', '200')
  .option('--debug-resolver', 'Print resolver ref traversal diagnostics', false)
  .action(async (inputs: string[], options: CliOptions) => {
    const cwd = process.cwd();
    const outputPath = path.resolve(cwd, options.output);
    const outputFormat = options.format ?? inferOutputFormat(outputPath);
    const maxDepth = Number(options.maxDepth);

    if (!Number.isInteger(maxDepth) || maxDepth < 1) {
      throw new Error('--max-depth must be a positive integer');
    }

    const result = await bundleToFile(inputs, outputPath, cwd, {
      outputFormat,
      validate: options.validate,
      failOnWarning: options.failOnWarning,
      maxDepth,
      debugResolver: options.debugResolver,
    });

    process.stdout.write(
      `${green('OK')} bundled ${blue(String(inputs.length))} input pattern(s) into ${blue(
        path.relative(cwd, outputPath) || outputPath
      )}\n`
    );

    if (result.warnings.length > 0) {
      process.stderr.write(
        `${yellow('WARN')} ${result.warnings.length} warning(s):\n${result.warnings
          .map((warning) => `- ${warning}`)
          .join('\n')}\n`
      );
    }
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(`${red('ERROR')} ${formatError(error)}\n`);
  process.exit(1);
});
