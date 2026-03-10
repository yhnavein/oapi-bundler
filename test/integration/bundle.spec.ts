import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import { describe, expect, test } from 'bun:test';
import { bundleDocuments, bundleToOutputs } from '../../src';
import { emitDocument } from '../../src/core/emit';
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
    const getOperation = (pathItem['/users/{id}'] as Record<string, unknown>).get as Record<
      string,
      unknown
    >;

    const parameters = getOperation.parameters as Array<Record<string, unknown>>;
    expect(parameters[0].required).toBe(true);

    const schema = (
      (
        ((getOperation.responses as Record<string, unknown>)['200'] as Record<string, unknown>)
          .content as Record<string, unknown>
      )['application/json'] as Record<string, unknown>
    ).schema as Record<string, unknown>;

    expect(schema.type).toBe('object');
    expect(schema.properties).toBeDefined();
    expect(schema.$ref).toBeUndefined();
  });

  test('keeps local refs for recursive schemas', async () => {
    const result = await bundleDocuments(['test/fixtures/cycle/root.yaml'], cwd, {
      outputFormat: 'yaml',
      validate: 'basic',
      maxDepth: 100,
    });

    const components = result.document.components as Record<string, unknown>;
    const schemas = components.schemas as Record<string, unknown>;
    const node = schemas.Node as Record<string, unknown>;
    const children = (node.properties as Record<string, unknown>).children as Record<
      string,
      unknown
    >;
    const items = children.items as Record<string, unknown>;

    expect(items.$ref).toBe('#/components/schemas/Node');

    const responseSchema = (
      (
        (
          (
            (result.document.paths as Record<string, unknown>)['/nodes/{id}'] as Record<
              string,
              unknown
            >
          ).get as Record<string, unknown>
        ).responses as Record<string, unknown>
      )['200'] as Record<string, unknown>
    ).content as Record<string, unknown>;

    expect(
      (
        (responseSchema['application/json'] as Record<string, unknown>).schema as Record<
          string,
          unknown
        >
      ).$ref
    ).toBe('#/components/schemas/Node');
  });

  test('aggressive schema reuse deduplicates strictly equal schemas', async () => {
    const result = await bundleDocuments(['test/fixtures/dedupe/root.yaml'], cwd, {
      outputFormat: 'yaml',
      validate: 'basic',
      maxDepth: 100,
      schemaReuse: 'aggressive',
    });

    const components = result.document.components as Record<string, unknown>;
    const schemas = components.schemas as Record<string, unknown>;
    const schemaNames = Object.keys(schemas);

    expect(schemaNames.length).toBe(1);
    expect(schemaNames[0]).toBe('Order');

    const paths = result.document.paths as Record<string, unknown>;
    const firstSchemaRef = (
      (
        (
          ((paths['/orders/{id}'] as Record<string, unknown>).get as Record<string, unknown>)
            .responses as Record<string, unknown>
        )['200'] as Record<string, unknown>
      ).content as Record<string, unknown>
    )['application/json'] as Record<string, unknown>;
    const secondSchemaRef = (
      (
        (
          ((paths['/orders-copy/{id}'] as Record<string, unknown>).get as Record<string, unknown>)
            .responses as Record<string, unknown>
        )['200'] as Record<string, unknown>
      ).content as Record<string, unknown>
    )['application/json'] as Record<string, unknown>;

    expect((firstSchemaRef.schema as Record<string, unknown>).$ref).toBe(
      '#/components/schemas/Order'
    );
    expect((secondSchemaRef.schema as Record<string, unknown>).$ref).toBe(
      '#/components/schemas/Order'
    );
  });

  test('writes multiple output formats in one run', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'oapi-bundler-'));
    const yamlOutput = path.join(tmpDir, 'openapi.yaml');
    const jsonOutput = path.join(tmpDir, 'openapi.json');

    try {
      await bundleToOutputs(
        ['test/fixtures/basic/root.yaml'],
        [
          { path: yamlOutput, format: 'yaml' },
          { path: jsonOutput, format: 'json' },
        ],
        cwd,
        {
          validate: 'basic',
          maxDepth: 100,
        }
      );

      const yaml = await readFile(yamlOutput, 'utf8');
      const json = await readFile(jsonOutput, 'utf8');

      expect(yaml.includes('openapi: 3.1.0')).toBe(true);
      expect(json.includes('"openapi": "3.1.0"')).toBe(true);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('keeps OpenAPI-friendly top-level output key order', async () => {
    const document = {
      components: { schemas: {} },
      info: { title: 'X', version: '1.0.0' },
      paths: {},
      openapi: '3.1.0',
      servers: [{ url: 'https://example.com' }],
      security: [{ bearerAuth: [] }],
      xMeta: true,
    };

    const json = emitDocument(document, 'json');

    const openapiIndex = json.indexOf('"openapi"');
    const infoIndex = json.indexOf('"info"');
    const serversIndex = json.indexOf('"servers"');
    const securityIndex = json.indexOf('"security"');
    const pathsIndex = json.indexOf('"paths"');
    const componentsIndex = json.indexOf('"components"');
    const xMetaIndex = json.indexOf('"xMeta"');

    expect(openapiIndex).toBeLessThan(infoIndex);
    expect(infoIndex).toBeLessThan(serversIndex);
    expect(serversIndex).toBeLessThan(securityIndex);
    expect(securityIndex).toBeLessThan(pathsIndex);
    expect(pathsIndex).toBeLessThan(componentsIndex);
    expect(componentsIndex).toBeLessThan(xMetaIndex);
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

    expect(run).rejects.toBeInstanceOf(BundlerError);
    expect(run).rejects.toMatchObject({ code: 'COMPONENT_CONFLICT' });
  });
});
