-- NOTE: auth.users is owned by Supabase's auth service. We reference it
-- for FK targets in the Drizzle schema (packages/db/src/schema.ts) but must
-- NOT create it here. Drizzle emitted a CREATE TABLE for it based on the
-- reference; that statement has been stripped intentionally.
--> statement-breakpoint
CREATE TABLE "domains" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color_token" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hours_logged" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"task_id" uuid,
	"week_plan_id" text,
	"unplanned_title" text,
	"date_iso" date NOT NULL,
	"hours" numeric(5, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_mutations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"op" text NOT NULL,
	"payload" jsonb NOT NULL,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_goals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"text" text NOT NULL,
	"timeline" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_reflections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"question_id" text NOT NULL,
	"answer" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"life_areas" text[],
	"last_activity_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"sleep_hours_per_day" numeric(4, 2) DEFAULT '8' NOT NULL,
	"maintenance_hours_per_day" numeric(4, 2) DEFAULT '1' NOT NULL,
	"weekly_capacity_hours" numeric(5, 2) DEFAULT '40' NOT NULL,
	"weekly_capacity_hours_derived" numeric(5, 2) DEFAULT '40' NOT NULL,
	"buffer_percent" integer DEFAULT 20 NOT NULL,
	"week_start_day" text DEFAULT 'monday' NOT NULL,
	"week_time_zone" text DEFAULT 'UTC' NOT NULL,
	"preferred_tone" text,
	"profession_type" text DEFAULT 'other' NOT NULL,
	"profession_other_text" text,
	"has_job" boolean DEFAULT false NOT NULL,
	"job_hours_per_week" numeric(5, 2) DEFAULT '0' NOT NULL,
	"is_student" boolean DEFAULT false NOT NULL,
	"class_hours_per_week" numeric(5, 2) DEFAULT '0' NOT NULL,
	"strictness" text DEFAULT 'structured' NOT NULL,
	"check_in_frequency" text,
	"planning_frequency" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "week_domains" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"week_plan_id" text NOT NULL,
	"name" text NOT NULL,
	"color_key" text NOT NULL,
	"principle_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "week_goals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"week_plan_id" text NOT NULL,
	"text" text NOT NULL,
	"completed_at" timestamp with time zone,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "week_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"week_plan_id" text NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "week_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"week_start_iso" date NOT NULL,
	"week_end_iso" date NOT NULL,
	"week_start_day" text NOT NULL,
	"week_time_zone" text NOT NULL,
	"is_frozen" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "week_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"week_plan_id" text NOT NULL,
	"week_domain_id" uuid NOT NULL,
	"title" text NOT NULL,
	"planned_hours" numeric(6, 2) DEFAULT '0' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"tags" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hours_logged" ADD CONSTRAINT "hours_logged_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hours_logged" ADD CONSTRAINT "hours_logged_task_id_week_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."week_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hours_logged" ADD CONSTRAINT "hours_logged_week_plan_id_week_plans_id_fk" FOREIGN KEY ("week_plan_id") REFERENCES "public"."week_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_mutations" ADD CONSTRAINT "pending_mutations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_goals" ADD CONSTRAINT "profile_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_reflections" ADD CONSTRAINT "profile_reflections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_domains" ADD CONSTRAINT "week_domains_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_domains" ADD CONSTRAINT "week_domains_week_plan_id_week_plans_id_fk" FOREIGN KEY ("week_plan_id") REFERENCES "public"."week_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_goals" ADD CONSTRAINT "week_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_goals" ADD CONSTRAINT "week_goals_week_plan_id_week_plans_id_fk" FOREIGN KEY ("week_plan_id") REFERENCES "public"."week_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_notes" ADD CONSTRAINT "week_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_notes" ADD CONSTRAINT "week_notes_week_plan_id_week_plans_id_fk" FOREIGN KEY ("week_plan_id") REFERENCES "public"."week_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_plans" ADD CONSTRAINT "week_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_tasks" ADD CONSTRAINT "week_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_tasks" ADD CONSTRAINT "week_tasks_week_plan_id_week_plans_id_fk" FOREIGN KEY ("week_plan_id") REFERENCES "public"."week_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_tasks" ADD CONSTRAINT "week_tasks_week_domain_id_week_domains_id_fk" FOREIGN KEY ("week_domain_id") REFERENCES "public"."week_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "domains_user_idx" ON "domains" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hours_logged_user_task_date_key" ON "hours_logged" USING btree ("user_id","task_id","date_iso") WHERE task_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "hours_logged_user_date_idx" ON "hours_logged" USING btree ("user_id","date_iso");--> statement-breakpoint
CREATE INDEX "hours_logged_user_week_idx" ON "hours_logged" USING btree ("user_id","week_plan_id");--> statement-breakpoint
CREATE INDEX "pending_mutations_user_idx" ON "pending_mutations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_reflections_user_question_key" ON "profile_reflections" USING btree ("user_id","question_id");--> statement-breakpoint
CREATE INDEX "week_domains_plan_idx" ON "week_domains" USING btree ("week_plan_id");--> statement-breakpoint
CREATE INDEX "week_domains_user_idx" ON "week_domains" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "week_goals_plan_idx" ON "week_goals" USING btree ("week_plan_id");--> statement-breakpoint
CREATE INDEX "week_notes_plan_idx" ON "week_notes" USING btree ("week_plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "week_plans_user_week_key" ON "week_plans" USING btree ("user_id","week_start_iso");--> statement-breakpoint
CREATE INDEX "week_plans_user_week_idx" ON "week_plans" USING btree ("user_id","week_start_iso");--> statement-breakpoint
CREATE INDEX "week_tasks_domain_idx" ON "week_tasks" USING btree ("week_domain_id");--> statement-breakpoint
CREATE INDEX "week_tasks_user_idx" ON "week_tasks" USING btree ("user_id");