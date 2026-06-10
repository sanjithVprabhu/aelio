import { SpecFormat, type IngestionResult, type JSONSchema, type ParsedAction } from '@aelio/types';
import { inferTier } from './tiering.js';
import { parseOpenAPI } from './openapi-parser.js';

/**
 * Additional spec-format parsers (manual §7 Spec Ingestion). Each normalizes a
 * source format into ParsedActions with a suggested tier. A format detector
 * routes raw input to the right parser.
 */

function keyify(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

// ---- Postman collection v2.x ----
interface PostmanItem {
  name: string;
  request?: {
    method?: string;
    url?: { raw?: string; path?: string[] } | string;
    description?: string;
    body?: { raw?: string };
  };
  item?: PostmanItem[];
}

export function parsePostman(raw: string): IngestionResult {
  const warnings: string[] = [];
  let doc: { info?: { name?: string }; item?: PostmanItem[] };
  try {
    doc = JSON.parse(raw);
  } catch {
    return empty(SpecFormat.Postman, ['Postman collection is not valid JSON.']);
  }
  const actions: ParsedAction[] = [];
  const walk = (items: PostmanItem[], tags: string[]) => {
    for (const it of items) {
      if (it.item) {
        walk(it.item, [...tags, it.name]);
        continue;
      }
      if (!it.request) continue;
      const method = (it.request.method ?? 'GET').toUpperCase();
      const url = it.request.url;
      const path =
        typeof url === 'string' ? url : url?.raw ?? '/' + (url?.path ?? []).join('/');
      const key = keyify(it.name || `${method}_${path}`);
      let inputSchema: JSONSchema = { type: 'object', properties: {} };
      if (it.request.body?.raw) {
        try {
          const parsed = JSON.parse(it.request.body.raw);
          inputSchema = {
            type: 'object',
            properties: Object.fromEntries(
              Object.keys(parsed).map((k) => [k, { type: typeof parsed[k] === 'number' ? 'number' : 'string' }]),
            ),
          };
        } catch {
          /* non-JSON body */
        }
      }
      actions.push({
        key,
        httpMethod: method,
        path: typeof path === 'string' ? path.replace(/^https?:\/\/[^/]+/, '') : '/',
        summary: it.name,
        description: it.request.description ?? it.name,
        inputSchema,
        suggestedTier: inferTier(method, `${key} ${it.name}`),
        tags,
      });
    }
  };
  walk(doc.item ?? [], []);
  if (actions.length === 0) warnings.push('No requests found in the Postman collection.');
  return { specId: '', format: SpecFormat.Postman, rawActionCount: actions.length, parsedActions: actions, warnings, errors: [] };
}

// ---- GraphQL SDL (queries → Tier 0, mutations → tiered by naming) ----
export function parseGraphQL(raw: string): IngestionResult {
  const actions: ParsedAction[] = [];
  const warnings: string[] = [];
  const grab = (typeName: 'Query' | 'Mutation') => {
    const re = new RegExp(`type\\s+${typeName}\\s*{([^}]*)}`, 'm');
    const block = re.exec(raw)?.[1];
    if (!block) return;
    for (const line of block.split('\n')) {
      const m = /^\s*([a-zA-Z_]\w*)\s*(\([^)]*\))?\s*:/.exec(line);
      if (!m) continue;
      const name = m[1]!;
      const argStr = m[2] ?? '';
      const props: Record<string, JSONSchema> = {};
      for (const a of argStr.matchAll(/([a-zA-Z_]\w*)\s*:\s*([A-Za-z!\[\]]+)/g)) {
        props[a[1]!] = { type: /Int|Float/.test(a[2]!) ? 'number' : 'string' };
      }
      actions.push({
        key: keyify(name),
        httpMethod: undefined,
        path: undefined,
        summary: name,
        description: `${typeName} ${name}`,
        inputSchema: { type: 'object', properties: props },
        suggestedTier:
          typeName === 'Query' ? 0 : inferTier('POST', name),
        tags: [typeName.toLowerCase()],
      });
    }
  };
  grab('Query');
  grab('Mutation');
  if (actions.length === 0) warnings.push('No Query/Mutation fields found in the GraphQL SDL.');
  return { specId: '', format: SpecFormat.GraphQL, rawActionCount: actions.length, parsedActions: actions, warnings, errors: [] };
}

// ---- MCP tool list (JSON array of {name, description, inputSchema}) ----
export function parseMCP(raw: string): IngestionResult {
  let tools: Array<{ name: string; description?: string; inputSchema?: JSONSchema }>;
  try {
    const parsed = JSON.parse(raw);
    tools = Array.isArray(parsed) ? parsed : (parsed.tools ?? []);
  } catch {
    return empty(SpecFormat.MCP, ['MCP tool list is not valid JSON.']);
  }
  const actions: ParsedAction[] = tools.map((t) => ({
    key: keyify(t.name),
    httpMethod: undefined,
    path: undefined,
    summary: t.name,
    description: t.description ?? t.name,
    inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
    suggestedTier: inferTier('POST', `${t.name} ${t.description ?? ''}`),
    tags: ['mcp'],
  }));
  return { specId: '', format: SpecFormat.MCP, rawActionCount: actions.length, parsedActions: actions, warnings: [], errors: [] };
}

// ---- Raw docs (heuristic extraction; always flags a warning) ----
export function parseRawDocs(raw: string): IngestionResult {
  const actions: ParsedAction[] = [];
  // Find "METHOD /path" patterns in free text.
  for (const m of raw.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[\w/{}.-]*)/g)) {
    const method = m[1]!;
    const path = m[2]!;
    const key = keyify(`${method}_${path}`);
    actions.push({
      key,
      httpMethod: method,
      path,
      summary: `${method} ${path}`,
      description: `${method} ${path}`,
      inputSchema: { type: 'object', properties: {} },
      suggestedTier: inferTier(method, `${key}`),
      tags: ['raw'],
    });
  }
  return {
    specId: '',
    format: SpecFormat.RawDocs,
    rawActionCount: actions.length,
    parsedActions: actions,
    warnings: ['Raw documentation parsed heuristically — review every action before exposing.'],
    errors: actions.length ? [] : ['No HTTP endpoints could be extracted from the docs.'],
  };
}

function empty(format: SpecFormat, errors: string[]): IngestionResult {
  return { specId: '', format, rawActionCount: 0, parsedActions: [], warnings: [], errors };
}

export function detectFormat(raw: string): SpecFormat {
  const trimmed = raw.trim();
  if (/type\s+(Query|Mutation)\s*{/.test(trimmed)) return SpecFormat.GraphQL;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const doc = JSON.parse(trimmed);
      if (doc.openapi || doc.paths) return SpecFormat.OpenAPI3;
      if (doc.swagger) return SpecFormat.OpenAPI2;
      if (doc.info?._postman_id || doc.item) return SpecFormat.Postman;
      if (Array.isArray(doc) && doc[0]?.inputSchema) return SpecFormat.MCP;
      if (doc.tools) return SpecFormat.MCP;
    } catch {
      /* fall through */
    }
  }
  return SpecFormat.RawDocs;
}

/** Parse any supported format, auto-detecting when not specified. */
export function parseSpec(raw: string, format?: SpecFormat): IngestionResult {
  const f = format ?? detectFormat(raw);
  switch (f) {
    case SpecFormat.OpenAPI3:
    case SpecFormat.OpenAPI2:
      return parseOpenAPI(raw);
    case SpecFormat.Postman:
      return parsePostman(raw);
    case SpecFormat.GraphQL:
      return parseGraphQL(raw);
    case SpecFormat.MCP:
      return parseMCP(raw);
    case SpecFormat.RawDocs:
    default:
      return parseRawDocs(raw);
  }
}
