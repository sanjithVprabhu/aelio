import type { ActionTier, JSONSchema } from './action.js';

export enum SpecFormat {
  OpenAPI3 = 'openapi_3',
  OpenAPI2 = 'openapi_2',
  Postman = 'postman',
  GraphQL = 'graphql',
  MCP = 'mcp',
  RawDocs = 'raw_docs',
}

export interface ParsedAction {
  key: string;
  httpMethod?: string;
  path?: string;
  summary: string;
  description: string;
  inputSchema: JSONSchema;
  outputSchema?: JSONSchema;
  suggestedTier: ActionTier;
  tags: string[];
}

export interface IngestionResult {
  specId: string;
  format: SpecFormat;
  rawActionCount: number;
  parsedActions: ParsedAction[];
  warnings: string[];
  errors: string[];
}

export interface ApiSpec {
  id: string;
  tenantId: string;
  format: SpecFormat;
  baseUrl: string;
  rawContent: string;
  parsedActions: ParsedAction[];
  warnings: string[];
  createdAt: Date;
}
