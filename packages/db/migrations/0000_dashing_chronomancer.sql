CREATE TYPE "public"."channel_status" AS ENUM('pending_verification', 'active', 'suspended', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."data_region" AS ENUM('us-east-1', 'eu-west-1', 'ap-south-1');--> statement-breakpoint
CREATE TYPE "public"."tenant_plan" AS ENUM('lite', 'pro', 'max', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('onboarding', 'active', 'suspended', 'churned');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "action_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"spec_id" uuid NOT NULL,
	"key" varchar(255) NOT NULL,
	"label" varchar(255) NOT NULL,
	"description" text NOT NULL,
	"http_method" varchar(10),
	"path" text,
	"base_url" text NOT NULL,
	"input_schema" jsonb NOT NULL,
	"output_schema" jsonb,
	"exposed" boolean DEFAULT false NOT NULL,
	"tier" integer DEFAULT 0 NOT NULL,
	"required_permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confirmation_copy" text,
	"before_after_template" text,
	"step_up_required" boolean DEFAULT false NOT NULL,
	"rate_limit_per_user_per_hour" integer DEFAULT 0 NOT NULL,
	"arg_constraints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pre_conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"post_action_message" text DEFAULT '' NOT NULL,
	"audit_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "action_invocations" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"action_key" varchar(255) NOT NULL,
	"tier" integer NOT NULL,
	"status" varchar(30) NOT NULL,
	"args_redacted" jsonb NOT NULL,
	"response_fields" jsonb,
	"error_message" text,
	"latency_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"role" varchar(50) DEFAULT 'member' NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_specs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"format" varchar(50) NOT NULL,
	"base_url" text NOT NULL,
	"raw_content" text NOT NULL,
	"parsed_actions" jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_events" (
	"id" varchar(96) PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid,
	"end_user_id" uuid,
	"admin_user_id" uuid,
	"event_type" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"trace_id" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" varchar(50) NOT NULL,
	"status" "channel_status" DEFAULT 'pending_verification' NOT NULL,
	"config" jsonb NOT NULL,
	"inbound_enabled" boolean DEFAULT true NOT NULL,
	"outbound_enabled" boolean DEFAULT false NOT NULL,
	"business_hours" jsonb,
	"fallback_message" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"status" varchar(50) NOT NULL,
	"active_channel_type" varchar(50) NOT NULL,
	"channel_id" uuid NOT NULL,
	"playbook_id" uuid NOT NULL,
	"playbook_version" varchar(50) NOT NULL,
	"user_state_at_start" varchar(100) NOT NULL,
	"current_user_state" varchar(100) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"last_activity_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "end_user_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"external_user_id" varchar(255) NOT NULL,
	"verification_status" varchar(50) NOT NULL,
	"verified_at" timestamp,
	"verification_channel" varchar(50),
	"encrypted_access_token" text,
	"token_expires_at" timestamp,
	"current_user_state" varchar(100) DEFAULT 'unverified' NOT NULL,
	"state_inferred_at" timestamp DEFAULT now() NOT NULL,
	"state_confidence" double precision DEFAULT 0 NOT NULL,
	"context_cached_at" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "escalations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"priority" varchar(20) DEFAULT 'normal' NOT NULL,
	"status" varchar(20) DEFAULT 'unassigned' NOT NULL,
	"assigned_to_id" uuid,
	"assigned_to_name" varchar(255),
	"claimed_at" timestamp,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suite_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"playbook_version" varchar(50) NOT NULL,
	"status" varchar(20) NOT NULL,
	"pass_count" integer DEFAULT 0 NOT NULL,
	"fail_count" integer DEFAULT 0 NOT NULL,
	"results" jsonb NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "eval_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suite_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"steps" jsonb NOT NULL,
	"expected_final_state" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "eval_suites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "identity_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel_type" varchar(50) NOT NULL,
	"identifier" varchar(255) NOT NULL,
	"trusted" boolean DEFAULT false NOT NULL,
	"linked_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kb_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"source_title" text NOT NULL,
	"content" text NOT NULL,
	"embedding" jsonb NOT NULL,
	"token_count" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kb_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"chunk_size" integer DEFAULT 600 NOT NULL,
	"overlap" integer DEFAULT 80 NOT NULL,
	"embedding_model" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kb_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" varchar(20) NOT NULL,
	"name" varchar(255) NOT NULL,
	"url" text,
	"status" varchar(20) NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"indexed_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "long_term_memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" varchar(255) NOT NULL,
	"value" jsonb NOT NULL,
	"confidence" double precision NOT NULL,
	"extracted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "onboarding_states" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"current_step" varchar(50) NOT NULL,
	"completed_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"spec_id" uuid,
	"channel_id" uuid,
	"playbook_id" uuid,
	"test_session_id" uuid,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pending_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" varchar(512) NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"action_key" varchar(255) NOT NULL,
	"confirmed_args" jsonb NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pending_confirmations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "playbooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" varchar(50) NOT NULL,
	"status" varchar(50) NOT NULL,
	"deployment_mode" varchar(50),
	"gradual_rollout_percent" integer,
	"config" jsonb NOT NULL,
	"bootstrapped_from_spec_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"published_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"plan" "tenant_plan" DEFAULT 'lite' NOT NULL,
	"status" "tenant_status" DEFAULT 'onboarding' NOT NULL,
	"region" "data_region" NOT NULL,
	"llm_config" jsonb NOT NULL,
	"api_base_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"role" varchar(20) NOT NULL,
	"content" jsonb NOT NULL,
	"channel_type" varchar(50) NOT NULL,
	"model_used" varchar(100),
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer,
	"meta" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "channels" ADD CONSTRAINT "channels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "action_tenant_key" ON "action_definitions" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_tenant_exposed" ON "action_definitions" USING btree ("tenant_id","exposed");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inv_tenant_conversation" ON "action_invocations" USING btree ("tenant_id","conversation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inv_tenant_action" ON "action_invocations" USING btree ("tenant_id","action_key","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_tenant_created" ON "audit_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_conversation" ON "audit_events" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conv_tenant_activity" ON "conversations" USING btree ("tenant_id","last_activity_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "eui_tenant_external" ON "end_user_identities" USING btree ("tenant_id","external_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "esc_tenant_status" ON "escalations" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ic_tenant_channel_identifier" ON "identity_channels" USING btree ("tenant_id","channel_type","identifier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_chunks_collection" ON "kb_chunks" USING btree ("tenant_id","collection_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ltm_identity" ON "long_term_memory" USING btree ("tenant_id","identity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "turns_conversation" ON "turns" USING btree ("conversation_id","created_at");