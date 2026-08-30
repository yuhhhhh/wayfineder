export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "initial_business_schema",
    sql: `
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        conversation_key TEXT NOT NULL UNIQUE,
        pi_session_id TEXT NOT NULL UNIQUE,
        chat_hash TEXT NOT NULL,
        summary TEXT,
        last_active_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE approvals (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('requested', 'awaiting_approval', 'confirmed', 'executing', 'succeeded', 'failed', 'expired', 'cancelled')),
        actor_hash TEXT NOT NULL,
        chat_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('viewer', 'operator', 'admin')),
        tool_name TEXT NOT NULL,
        parameter_digest TEXT NOT NULL,
        risk_level TEXT NOT NULL CHECK (risk_level IN ('read_only', 'recoverable', 'high_risk')),
        token_digest TEXT NOT NULL UNIQUE,
        precondition_summary TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        confirmed_at TEXT
      ) STRICT;

      CREATE TABLE audit_events (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        external_event_id TEXT,
        actor_hash TEXT NOT NULL,
        conversation_key TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        parameter_summary TEXT NOT NULL,
        approval_id TEXT REFERENCES approvals(id),
        status TEXT NOT NULL CHECK (status IN ('started', 'succeeded', 'failed', 'denied', 'timed_out', 'cancelled', 'interrupted')),
        error_type TEXT,
        result_summary TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT
      ) STRICT;

      CREATE INDEX audit_events_request_idx ON audit_events(request_id, started_at DESC);
      CREATE INDEX audit_events_tool_time_idx ON audit_events(tool_name, started_at DESC);
      CREATE INDEX audit_events_status_time_idx ON audit_events(status, started_at DESC);

      CREATE TABLE alerts (
        id TEXT PRIMARY KEY,
        dedup_key TEXT NOT NULL,
        severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
        status TEXT NOT NULL CHECK (status IN ('firing', 'resolved', 'acknowledged')),
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        resolved_at TEXT
      ) STRICT;

      CREATE UNIQUE INDEX alerts_active_dedup_idx
        ON alerts(dedup_key) WHERE status = 'firing';
      CREATE INDEX alerts_recent_idx ON alerts(updated_at DESC);

      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        job_type TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted')),
        dedup_key TEXT,
        scheduled_at TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        error_type TEXT
      ) STRICT;

      CREATE INDEX jobs_status_schedule_idx ON jobs(status, scheduled_at);

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE inbound_events (
        event_id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        conversation_key TEXT NOT NULL,
        actor_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('received', 'processing', 'completed', 'failed', 'ignored')),
        received_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        error_type TEXT
      ) STRICT;

      CREATE INDEX inbound_events_status_time_idx ON inbound_events(status, updated_at);
    `,
  },
];
