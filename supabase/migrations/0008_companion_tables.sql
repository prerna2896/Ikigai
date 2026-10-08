-- 0008 — Kenji companion: transcript + two-tier context store
--
-- companion_messages: append-only chat transcript, one row per message.
-- companion_context: one row per user, holding BOTH a slow-changing
-- persona summary and a fast-changing recent-interaction digest — see
-- packages/companion/src/contextService.ts for the staleness rules that
-- decide when each tier gets recomputed (event-triggered, not a cron
-- job — this repo has none).
--
-- Hand-written rather than taken verbatim from `drizzle-kit generate`:
-- the generator's own journal only knows about 0000_init_schema (every
-- migration since has been hand-added without updating it), so a fresh
-- `pnpm db:generate` re-proposes changes from 0003/0004 that are
-- already live. Only the genuinely-new companion_context/
-- companion_messages statements are kept here; the role CHECK
-- constraint below is added by hand, same as insight_reactions' CHECK
-- constraints in 0006 (Drizzle's pgTable API doesn't express
-- column-level CHECK constraints).

CREATE TABLE "companion_context" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"persona_summary" text DEFAULT '' NOT NULL,
	"persona_updated_at" timestamp with time zone,
	"persona_source_message_count" integer DEFAULT 0 NOT NULL,
	"recent_interaction_summary" text DEFAULT '' NOT NULL,
	"recent_interaction_updated_at" timestamp with time zone,
	"recent_interaction_conversation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companion_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"crisis_flag" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companion_messages_role_check" CHECK ("role" IN ('user', 'assistant'))
);
--> statement-breakpoint
ALTER TABLE "companion_context" ADD CONSTRAINT "companion_context_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "companion_messages" ADD CONSTRAINT "companion_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "companion_messages_user_created_idx" ON "companion_messages" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX "companion_messages_user_convo_created_idx" ON "companion_messages" USING btree ("user_id","conversation_id","created_at");
