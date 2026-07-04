export interface ServerRuntimeConfig {
  port: number;
  host: string;
  baseUrl: string;
  customerBackendUrl: string;
  publicChatPath: string;
  demoRoot: string;
  allowInMemoryBoot: boolean;
  enableDemoRoutes: boolean;
  persistenceMode: 'postgres' | 'memory';
  memoryMode: 'sunjet' | 'postgres' | 'memory';
}

export function resolveServerRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): ServerRuntimeConfig {
  const port = Number(env.PORT ?? 3000);
  const host = env.HOST ?? '0.0.0.0';
  const baseUrl = env.BASE_URL ?? `http://localhost:${port}`;
  const hasDatabase = Boolean(env.DATABASE_URL);
  const hasSunjet = Boolean(env.SUNJET_URL);

  let memoryMode: ServerRuntimeConfig['memoryMode'] = 'memory';
  if (hasSunjet) memoryMode = 'sunjet';
  else if (hasDatabase) memoryMode = 'postgres';

  return {
    port,
    host,
    baseUrl,
    customerBackendUrl: env.AELIO_CUSTOMER_BACKEND_URL ?? 'http://localhost:3101',
    publicChatPath: '/chat',
    demoRoot: '/demo',
    allowInMemoryBoot: env.AELIO_ALLOW_IN_MEMORY !== '0',
    enableDemoRoutes: env.AELIO_ENABLE_DEMO_ROUTES !== '0',
    persistenceMode: hasDatabase ? 'postgres' : 'memory',
    memoryMode,
  };
}
