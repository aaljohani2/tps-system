-- Non-destructive TPS local development schema. UTC timestamps; term dates are local calendar dates.
CREATE TABLE IF NOT EXISTS institutions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS colleges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), institution_id uuid NOT NULL REFERENCES institutions(id),
 name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(institution_id,name)
);
CREATE TABLE IF NOT EXISTS departments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), college_id uuid NOT NULL REFERENCES colleges(id),
 name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(college_id,name)
);
CREATE TABLE IF NOT EXISTS academic_terms (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), college_id uuid NOT NULL REFERENCES colleges(id),
 code text NOT NULL, label text NOT NULL, starts_on date NOT NULL, ends_on date NOT NULL,
 is_active boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_on >= starts_on), UNIQUE(college_id,code)
);
CREATE TABLE IF NOT EXISTS courses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), department_id uuid NOT NULL REFERENCES departments(id),
 code text NOT NULL, title text NOT NULL, level integer NOT NULL CHECK (level BETWEEN 1 AND 12),
 theory_hours integer NOT NULL DEFAULT 0 CHECK (theory_hours >= 0),
 practical_hours integer NOT NULL DEFAULT 0 CHECK (practical_hours >= 0),
 demand integer NOT NULL DEFAULT 0 CHECK (demand >= 0),
 mode text NOT NULL DEFAULT 'ONSITE' CHECK(mode IN ('ONSITE','REMOTE','SELF_PACED','HYBRID')),
 eligible_modes jsonb NOT NULL DEFAULT '["ONSITE"]',
 blocks jsonb NOT NULL DEFAULT '[]',
 hybrid_split jsonb,
 assigned_instructor_id text,
 exclusive_instructor boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(department_id,code),
 CHECK(theory_hours+practical_hours > 0)
);
CREATE TABLE IF NOT EXISTS instructors (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), department_id uuid NOT NULL REFERENCES departments(id),
 code text NOT NULL, name text NOT NULL, max_load numeric(8,3) NOT NULL DEFAULT 0 CHECK (max_load >= 0),
 allowed_modes jsonb NOT NULL DEFAULT '["ONSITE"]',
 eligible_course_codes jsonb,
 available jsonb,
 overload jsonb,
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(department_id,code)
);
CREATE TABLE IF NOT EXISTS rooms (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), college_id uuid NOT NULL REFERENCES colleges(id),
 code text NOT NULL, name text NOT NULL, type text NOT NULL CHECK(type IN ('CLASSROOM','LAB','MULTI')),
 capacity integer NOT NULL CHECK(capacity > 0), available jsonb,
 building text, updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(college_id,code)
);
CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), username text NOT NULL UNIQUE,
 password_hash text NOT NULL, role text NOT NULL CHECK(role IN ('SYSTEM_ADMIN','COLLEGE_ADMIN','DEPARTMENT_HEAD','SCHEDULER','REVIEWER','APPROVER','TRAINER','VIEWER')),
 college_id uuid REFERENCES colleges(id), department_id uuid REFERENCES departments(id),
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS user_sessions (
 id_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 csrf_token text NOT NULL, expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_sessions_exp_idx ON user_sessions(expires_at);
CREATE TABLE IF NOT EXISTS scenarios (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), department_id uuid NOT NULL REFERENCES departments(id),
 term_id uuid NOT NULL REFERENCES academic_terms(id), name text NOT NULL,
 state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','UNDER_REVIEW','APPROVED','REJECTED','ARCHIVED')),
 solver_status text NOT NULL DEFAULT 'NOT_RUN' CHECK(solver_status IN ('NOT_RUN','COMPLETED','FAILED')),
 input_snapshot jsonb NOT NULL, result_snapshot jsonb NOT NULL,
 solver_details jsonb, approved_snapshot jsonb,
 created_by uuid NOT NULL REFERENCES users(id), approved_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), approved_at timestamptz,
 revision integer NOT NULL DEFAULT 1 CHECK(revision > 0)
);
CREATE INDEX IF NOT EXISTS scenarios_scope_idx ON scenarios(department_id,term_id,created_at DESC);
CREATE TABLE IF NOT EXISTS audit_logs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id uuid REFERENCES users(id), action text NOT NULL, entity_type text NOT NULL,
 entity_id text, details jsonb, occurred_at timestamptz NOT NULL DEFAULT now()
);
