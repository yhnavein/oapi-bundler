import path from 'node:path';
import { describe, expect, test } from 'bun:test';
import { bundleDocuments } from '../../src';
import { BundlerError } from '../../src/core/errors';

const cwd = path.resolve(__dirname, '..', '..');

describe('bundleDocuments', () => {
  test('dereferences external refs and forces required path parameters', async () => {
    const result = await bundleDocuments(['test/fixtures/basic/root.yaml'], cwd, {
      outputFormat: 'yaml',
      validate: 'basic',
      maxDepth: 100,
    });

    const pathItem = result.document.paths as Record<string, unknown>;
    const getOperation = (pathItem['/users/{id}'] as Record<string, unknown>)
      .get as Record<string, unknown>;

    const parameters = getOperation.parameters as Array<Record<string, unknown>>;
    expect(parameters[0].required).toBe(true);

    const schema = (
      (
        (
          (getOperation.responses as Record<string, unknown>)['200'] as Record<
            string,
            unknown
          >
        ).content as Record<string, unknown>
      )['application/json'] as Record<string, unknown>
    ).schema as Record<string, unknown>;

    expect(schema.type).toBe('object');
    expect(schema.properties).toBeDefined();
  });

  test('fails on component conflicts', async () => {
    const run = bundleDocuments(
      ['test/fixtures/conflict/a.yaml', 'test/fixtures/conflict/b.yaml'],
      cwd,
      {
        outputFormat: 'yaml',
        validate: 'basic',
        maxDepth: 100,
      }
    );

    await expect(run).rejects.toBeInstanceOf(BundlerError);
    await expect(run).rejects.toMatchObject({ code: 'COMPONENT_CONFLICT' });
  });
});
