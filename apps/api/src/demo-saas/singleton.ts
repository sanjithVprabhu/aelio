import { DemoSaasStore } from '@aelio/demo-saas';

let store: DemoSaasStore | null = null;

export async function getDemoSaasStore(): Promise<DemoSaasStore | null> {
  if (!process.env.DATABASE_URL) return null;
  if (!store) {
    store = new DemoSaasStore();
    await store.connect();
  }
  return store;
}