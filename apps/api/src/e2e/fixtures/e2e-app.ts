import { AelioConvox } from '@aelio/convox-sdk';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import type { Container } from '../../container.js';
import { configureGeminiStackEnv, sleep, waitFor } from './e2e-env.js';
import { registerDemoCatalog, resetDemoAccounts } from './demo-catalog.js';

export interface E2eStack {
  app: FastifyInstance;
  container: Container;
  baseUrl: string;
  tenantId: string;
  convox: AelioConvox;
}

export async function bootConvoxE2eStack(): Promise<E2eStack> {
  configureGeminiStackEnv();
  resetDemoAccounts();

  const built = await buildApp();
  const app = built.app;
  const container = built.container;
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 3000;
  const baseUrl = `http://127.0.0.1:${port}`;
  const tenantId = container.store.getTenantBySlug('acme')!.id;

  const convox = new AelioConvox({
    tenantId: 'acme',
    apiKey: 'test_api_key',
    aelioBaseUrl: baseUrl,
  });
  registerDemoCatalog(convox);
  await convox.connect();
  await waitFor(() => container.convox.listTools(tenantId).length >= 8, 8000);
  await waitFor(() => container.convox.listFlows(tenantId).length >= 3, 5000);
  container.convoxBridge.syncFromRegistry(tenantId);
  await container.convoxStateBridge.syncFromRegistry(tenantId);
  await container.convoxFlowBridge.syncFromRegistry(tenantId);
  await container.persistence?.flush();

  return { app, container, baseUrl, tenantId, convox };
}

export async function shutdownE2eStack(stack?: E2eStack): Promise<void> {
  await stack?.convox?.disconnect();
  // Allow fire-and-forget memory index writes to finish before closing Postgres.
  await sleep(800);
  await stack?.container?.persistence?.flush();
  await stack?.app?.close();
  await stack?.container?.persistence?.close();
}

export async function verifyViaChat(
  baseUrl: string,
  sessionId: string,
): Promise<void> {
  const hello = await fetch(`${baseUrl}/api/v1/chat/acme/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, text: 'hello' }),
  });
  const body = (await hello.json()) as { replies?: Array<{ url?: string }> };
  const url = body.replies?.[0]?.url;
  if (!url) throw new Error('expected magic link');
  const token = url.split('/').pop()!;
  const verify = await fetch(`${baseUrl}/verify/${token}`);
  if (!verify.ok) throw new Error(`verify failed: ${verify.status}`);
  await sleep(200);
}

export async function chat(
  baseUrl: string,
  sessionId: string,
  text: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${baseUrl}/api/v1/chat/acme/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, text }),
  });
  if (!res.ok) throw new Error(`chat failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as Record<string, unknown>;
}