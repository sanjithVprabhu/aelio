import { SpecFormat, type IngestionResult, type JSONSchema, type ParsedAction } from '@aelio/types';
import { inferTier } from './tiering.js';

/**
 * Minimal but real OpenAPI 3 / Swagger 2 parser. Walks paths × methods,
 * resolves local $refs, derives an input JSON Schema from path/query params and
 * request body, and assigns a suggested tier. Thin descriptions are flagged as
 * warnings (the manual's "N endpoints missing descriptions" surface).
 */

interface OpenAPIDoc {
  openapi?: string;
  swagger?: string;
  servers?: Array<{ url: string }>;
  host?: string;
  basePath?: string;
  schemes?: string[];
  components?: { schemas?: Record<string, JSONSchema> };
  definitions?: Record<string, JSONSchema>;
  paths: Record<string, Record<string, OpenAPIOperation>>;
}

interface OpenAPIOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenAPIParam[];
  requestBody?: {
    content?: Record<string, { schema?: JSONSchema }>;
  };
  responses?: Record<string, { content?: Record<string, { schema?: JSONSchema }> }>;
}

interface OpenAPIParam {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie' | 'body';
  required?: boolean;
  description?: string;
  schema?: JSONSchema;
  type?: string; // swagger 2
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

function resolveRef(doc: OpenAPIDoc, schema: JSONSchema | undefined): JSONSchema {
  if (!schema) return { type: 'object' };
  const ref = (schema as { $ref?: string }).$ref;
  if (ref) {
    const name = ref.split('/').pop()!;
    const target = doc.components?.schemas?.[name] ?? doc.definitions?.[name];
    return target ? resolveRef(doc, target) : { type: 'object' };
  }
  return schema;
}

function deriveBaseUrl(doc: OpenAPIDoc): string {
  if (doc.servers?.[0]?.url) return doc.servers[0].url;
  if (doc.host) {
    const scheme = doc.schemes?.[0] ?? 'https';
    return `${scheme}://${doc.host}${doc.basePath ?? ''}`;
  }
  return '';
}

function keyFromOperation(method: string, path: string, op: OpenAPIOperation): string {
  if (op.operationId) {
    return op.operationId
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .toLowerCase();
  }
  const segments = path
    .split('/')
    .filter(Boolean)
    .map((s) => s.replace(/[{}]/g, ''));
  return `${method}_${segments.join('_')}`.toLowerCase();
}

export function parseOpenAPI(raw: string): IngestionResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  let doc: OpenAPIDoc;
  try {
    doc = JSON.parse(raw) as OpenAPIDoc;
  } catch {
    // Tolerate a small subset of YAML by failing clearly rather than guessing.
    return {
      specId: '',
      format: SpecFormat.OpenAPI3,
      rawActionCount: 0,
      parsedActions: [],
      warnings,
      errors: ['Spec is not valid JSON. Provide an OpenAPI JSON document.'],
    };
  }

  const format = doc.swagger ? SpecFormat.OpenAPI2 : SpecFormat.OpenAPI3;
  const baseUrl = deriveBaseUrl(doc);
  if (!baseUrl) warnings.push('No server/base URL found in spec — set the tenant API base URL.');

  const parsedActions: ParsedAction[] = [];
  let rawCount = 0;
  let missingDescriptions = 0;

  for (const [path, methods] of Object.entries(doc.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = methods[method];
      if (!op) continue;
      rawCount++;

      const properties: Record<string, JSONSchema> = {};
      const required: string[] = [];

      for (const param of op.parameters ?? []) {
        if (param.in === 'header' || param.in === 'cookie') continue;
        const schema = param.schema
          ? resolveRef(doc, param.schema)
          : { type: param.type ?? 'string' };
        properties[param.name] = { ...schema, description: param.description };
        if (param.required) required.push(param.name);
      }

      const bodySchema = op.requestBody?.content?.['application/json']?.schema;
      if (bodySchema) {
        const resolved = resolveRef(doc, bodySchema);
        const props = (resolved as { properties?: Record<string, JSONSchema> }).properties;
        const req = (resolved as { required?: string[] }).required ?? [];
        if (props) {
          for (const [k, v] of Object.entries(props)) {
            properties[k] = resolveRef(doc, v);
          }
          required.push(...req);
        }
      }

      const summary = op.summary ?? op.operationId ?? `${method.toUpperCase()} ${path}`;
      let description = op.description ?? op.summary ?? '';
      if (!description) {
        missingDescriptions++;
        description = `${method.toUpperCase()} ${path}`;
      }

      const inputSchema: JSONSchema = {
        type: 'object',
        properties,
        required: [...new Set(required)],
      };

      parsedActions.push({
        key: keyFromOperation(method, path, op),
        httpMethod: method.toUpperCase(),
        path,
        summary,
        description,
        inputSchema,
        suggestedTier: inferTier(method, `${keyFromOperation(method, path, op)} ${summary}`),
        tags: op.tags ?? [],
      });
    }
  }

  if (missingDescriptions > 0) {
    warnings.push(
      `${missingDescriptions} endpoint(s) missing descriptions — placeholders generated; refine in the policy editor.`,
    );
  }

  return {
    specId: '',
    format,
    rawActionCount: rawCount,
    parsedActions,
    warnings,
    errors,
  };
}
