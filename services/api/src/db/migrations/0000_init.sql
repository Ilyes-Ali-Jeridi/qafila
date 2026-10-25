CREATE TABLE "agent_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid,
	"action" text NOT NULL,
	"decision" text NOT NULL,
	"reasoning" text NOT NULL,
	"inputs" jsonb,
	"tx_hash" text,
	"status" text NOT NULL,
	"dry_run" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" uuid,
	"action" text NOT NULL,
	"target" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"severity" text NOT NULL,
	"evidence" jsonb
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"onchain_id" bigint,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "deals_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"importer_id" uuid NOT NULL,
	"supplier_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"terms" jsonb,
	"currency" text DEFAULT 'USD',
	"goods_summary" text NOT NULL,
	"route" jsonb NOT NULL,
	"carrier" text,
	"share_token" text,
	"issuer_public_key" text,
	"factory_tx_hashes" jsonb DEFAULT '[]'::jsonb,
	"report_id" uuid,
	"bl_report_id" uuid,
	"listing_fingerprint" text,
	"shipment_fingerprint" text,
	"payment_mode" text DEFAULT 'Native' NOT NULL,
	"escrow_id" text,
	"security" numeric(30, 0),
	"abort_reason" text,
	"abort_note" text,
	"bl_released_at" timestamp with time zone,
	"bl_release_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deals_onchain_id_unique" UNIQUE("onchain_id"),
	CONSTRAINT "deals_listing_fingerprint_unique" UNIQUE("listing_fingerprint"),
	CONSTRAINT "deals_shipment_fingerprint_unique" UNIQUE("shipment_fingerprint")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"type" text NOT NULL,
	"storage_path" text NOT NULL,
	"sha256" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"pages" integer,
	"uploaded_by" uuid,
	"stage" text DEFAULT 'listing' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extension_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"requested_secs" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decision_note" text,
	"decided_by" uuid,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "external_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"adapter" text NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb,
	"status" text NOT NULL,
	"cost" numeric(12, 6),
	"mode" text NOT NULL,
	"cached_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "importers" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"legal_name" text NOT NULL,
	"country" text NOT NULL,
	"registration_number" text,
	"kyb_status" text DEFAULT 'pending' NOT NULL,
	"documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"faucet_grant_tx" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid,
	"kind" text NOT NULL,
	"detail" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "indexer_cursor" (
	"contract_id" text PRIMARY KEY NOT NULL,
	"cursor" text,
	"last_ledger" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"result" jsonb,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid,
	"kind" text NOT NULL,
	"deal_id" uuid,
	"payload" jsonb,
	"sent_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onchain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" text NOT NULL,
	"ledger" integer NOT NULL,
	"tx_hash" text NOT NULL,
	"event_index" integer NOT NULL,
	"event_type" text NOT NULL,
	"deal_onchain_id" bigint,
	"data" jsonb NOT NULL,
	"ledger_closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"halal_categories" jsonb NOT NULL,
	"thresholds" jsonb NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" text,
	"display_name" text NOT NULL,
	"email" text,
	"country" text,
	"roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"wallet_address" text,
	"wallet_kind" text,
	"kyc_status" text DEFAULT 'none' NOT NULL,
	"kyc_approved_tx" text,
	"joined_via" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_auth_user_id_unique" UNIQUE("auth_user_id"),
	CONSTRAINT "profiles_wallet_address_unique" UNIQUE("wallet_address")
);
--> statement-breakpoint
CREATE TABLE "promises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"listing_fingerprint" text NOT NULL,
	"text" text NOT NULL,
	"text_hash" text NOT NULL,
	"template_version" text NOT NULL,
	"security" numeric(30, 0) NOT NULL,
	"security_bps" integer NOT NULL,
	"onchain_tx_hash" text,
	"signed_at" timestamp with time zone,
	"withdrawn_tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid,
	"stage" text NOT NULL,
	"canonical_json" text NOT NULL,
	"hash" text NOT NULL,
	"decision" text NOT NULL,
	"risk_score" integer NOT NULL,
	"signature" text,
	"purpose" integer,
	"prompt_versions" jsonb,
	"model_ids" jsonb,
	"adapter_modes" jsonb,
	"latency_ms" integer,
	"cost_usd" numeric(12, 6),
	"explanation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"deal_id" uuid PRIMARY KEY NOT NULL,
	"carrier" text NOT NULL,
	"container_numbers" text[] NOT NULL,
	"bl_number" text NOT NULL,
	"bl_document_id" uuid,
	"tracking_request_id" text,
	"status_code" integer,
	"vessel" text,
	"imo" text,
	"pol" text,
	"pod" text,
	"departure" timestamp with time zone,
	"arrival" timestamp with time zone,
	"events" jsonb DEFAULT '[]'::jsonb,
	"mode" text,
	"last_polled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"token" text NOT NULL,
	"payout_address" text,
	"signature" text,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "supplier_confirmations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name_zh" text,
	"name_en" text NOT NULL,
	"uscc" text,
	"country" text DEFAULT 'CN' NOT NULL,
	"payout_address" text,
	"payout_confirmed_at" timestamp with time zone,
	"payout_signature" text,
	"registry_snapshot" jsonb,
	"sanctions_result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "x402_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" text NOT NULL,
	"payer" text,
	"amount" text,
	"tx_hash" text,
	"report_id" uuid,
	"job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "x402_payments_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_profiles_id_fk" FOREIGN KEY ("actor") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_importer_id_profiles_id_fk" FOREIGN KEY ("importer_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_profiles_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extension_requests" ADD CONSTRAINT "extension_requests_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extension_requests" ADD CONSTRAINT "extension_requests_decided_by_profiles_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "importers" ADD CONSTRAINT "importers_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy" ADD CONSTRAINT "policy_updated_by_profiles_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promises" ADD CONSTRAINT "promises_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_bl_document_id_documents_id_fk" FOREIGN KEY ("bl_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_confirmations" ADD CONSTRAINT "supplier_confirmations_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x402_payments" ADD CONSTRAINT "x402_payments_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deals_status_idx" ON "deals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "deals_importer_idx" ON "deals" USING btree ("importer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_calls_req_idx" ON "external_calls" USING btree ("adapter","request_hash");--> statement-breakpoint
CREATE INDEX "jobs_status_run_idx" ON "jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_idx" ON "jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "onchain_events_tx_idx" ON "onchain_events" USING btree ("tx_hash","event_index");--> statement-breakpoint
CREATE INDEX "onchain_events_deal_idx" ON "onchain_events" USING btree ("deal_onchain_id");