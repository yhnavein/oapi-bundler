#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { Command } from 'commander';
import { blue, green, red, yellow } from 'nanocolors';
import {
  bundleToOutputs,
  type BundleOutputTarget,
  inferOutputFormat,
} from './core/bundle';
import { formatError } from './core/errors';
import type { OutputFormat, SchemaReuseMode, ValidationMode } from './core/types';

interface CliOptions {
  output: string[];
  format?: OutputFormat;
  validate: ValidationMode;
  failOnWarning: boolean;
  maxDepth: string;
  debugResolver: boolean;
  schemaReuse: SchemaReuseMode;
}

const program = new Command();

program
  .name('oapi-bundler')
  .description('Merge modular OpenAPI files into one dereferenced document')
  .argument('<inputs...>', 'Input files or glob patterns')
  .requiredOption('-o, --output <files...>', 'Output file path(s)')
  .option('--format <yaml|json>', 'Output format (inferred from output extension by default)')
  .option('--validate <basic|strict>', 'Validation mode', 'basic')
  .option('--fail-on-warning', 'Fail if warnings are produced', false)
  .option('--max-depth <n>', 'Maximum resolver traversal depth', '200')
  .option('--debug-resolver', 'Print resolver ref traversal diagnostics', false)
  .option(
    '--schema-reuse <inline|minimal|aggressive>',
    'Schema reuse strategy',
    'inline'
  )
  .action(async (inputs: string[], options: CliOptions) => {
    const cwd = process.cwd();
    const outputPaths = options.output.map((outputPath) => path.resolve(cwd, outputPath));
    const maxDepth = Number(options.maxDepth);

    if (!Number.isInteger(maxDepth) || maxDepth < 1) {
      throw new Error('--max-depth must be a positive integer');
    }

    if (!['inline', 'minimal', 'aggressive'].includes(options.schemaReuse)) {
      throw new Error('--schema-reuse must be inline, minimal, or aggressive');
    }

    if (outputPaths.length > 1 && options.format) {
      throw new Error('--format can only be used with a single output file');
    }

    const outputTargets: BundleOutputTarget[] = outputPaths.map((outputPath) => ({
      path: outputPath,
      format: options.format ?? inferOutputFormat(outputPath),
    }));

    const result = await bundleToOutputs(inputs, outputTargets, cwd, {
      validate: options.validate,
      failOnWarning: options.failOnWarning,
      maxDepth,
      debugResolver: options.debugResolver,
      schemaReuse: options.schemaReuse,
    });

    const relativeOutputs = outputPaths
      .map((outputPath) => path.relative(cwd, outputPath) || outputPath)
      .join(', ');

    process.stdout.write(
      `${green('OK')} bundled ${blue(String(inputs.length))} input pattern(s) into ${blue(
        relativeOutputs
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
