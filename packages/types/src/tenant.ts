import type { LLMConfig } from './llm.js';

export enum TenantPlan {
  Lite = 'lite',
  Pro = 'pro',
  Max = 'max',
  Enterprise = 'enterprise',
}

export enum TenantStatus {
  Onboarding = 'onboarding',
  Active = 'active',
  Suspended = 'suspended',
  Churned = 'churned',
}

export enum DataRegion {
  UsEast = 'us-east-1',
  EuWest = 'eu-west-1',
  ApSouth = 'ap-south-1',
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: TenantPlan;
  status: TenantStatus;
  region: DataRegion;
  llmConfig: LLMConfig;
  /** Base URL of the tenant's SaaS API — the auth proxy targets this. */
  apiBaseUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
  createdAt: Date;
}
