CREATE TABLE "run_steps" (
	"run_id" text NOT NULL,
	"node_id" text NOT NULL,
	"state" text NOT NULL,
	"resolved_params" jsonb,
	"output" jsonb,
	"error" jsonb,
	"fired_ports" text[] NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"attempt" integer NOT NULL,
	CONSTRAINT "run_steps_run_id_node_id_pk" PRIMARY KEY("run_id","node_id"),
	CONSTRAINT "run_steps_state_check" CHECK ("run_steps"."state" IN ('pending', 'running', 'success', 'error', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"workflow_snapshot" jsonb NOT NULL,
	"trigger_payload" jsonb,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "runs_status_check" CHECK ("runs"."status" IN ('running', 'success', 'error', 'blocked'))
);
--> statement-breakpoint
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runs_workflow_id_started_at_idx" ON "runs" USING btree ("workflow_id","started_at");