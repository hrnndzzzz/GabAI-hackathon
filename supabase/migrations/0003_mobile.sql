-- Mobile v1.2: profile details and picture, classes with class lists, assessment due dates,
-- hand-in times, schedule events and feedback. Run as the migration administrator after 0002.
BEGIN;

-- Profile details, generated or uploaded picture, and settings that follow the teacher.
ALTER TABLE teacher_profiles
  ADD COLUMN full_name VARCHAR(120),
  ADD COLUMN school_name VARCHAR(160),
  ADD COLUMN avatar_style VARCHAR(10) NOT NULL DEFAULT 'initials',
  ADD COLUMN avatar_color VARCHAR(7),
  ADD COLUMN avatar_pattern VARCHAR(20),
  ADD COLUMN avatar_image BYTEA,
  ADD COLUMN avatar_updated_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN preferences JSON NOT NULL DEFAULT '{}',
  ADD COLUMN preferences_updated_at TIMESTAMP WITH TIME ZONE,
  ADD CONSTRAINT teacher_profiles_avatar_style CHECK (avatar_style IN ('initials', 'pattern', 'photo')),
  ADD CONSTRAINT teacher_profiles_avatar_color CHECK (avatar_color IS NULL OR avatar_color ~ '^#[0-9A-Fa-f]{6}$'),
  -- The API stores a 256 px JPEG; this only guards against a regression storing originals.
  ADD CONSTRAINT teacher_profiles_avatar_size CHECK (avatar_image IS NULL OR octet_length(avatar_image) <= 524288);

-- School level and grade number for grade levels the mobile app creates.
ALTER TABLE grade_levels
  ADD COLUMN level VARCHAR(20),
  ADD COLUMN grade INTEGER,
  ADD CONSTRAINT grade_levels_owner_level_grade UNIQUE (owner_id, level, grade),
  ADD CONSTRAINT grade_levels_level CHECK (level IS NULL OR level IN ('elementary', 'highschool', 'college')),
  ADD CONSTRAINT grade_levels_grade CHECK (
    (level IS NULL AND grade IS NULL)
    OR (level = 'elementary' AND grade BETWEEN 0 AND 6)
    OR (level = 'highschool' AND grade BETWEEN 7 AND 12)
    OR (level = 'college' AND grade BETWEEN 1 AND 4));

-- One section taught one subject, with its current class list (enrollments keep the history).
CREATE TABLE teaching_classes (
	section_id UUID NOT NULL,
	subject_id UUID NOT NULL,
	roster JSON NOT NULL,
	archived BOOLEAN NOT NULL,
	revision INTEGER NOT NULL,
	id UUID NOT NULL,
	owner_id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (id, owner_id),
	CONSTRAINT fk_teaching_classes_section_id FOREIGN KEY(section_id, owner_id) REFERENCES sections (id, owner_id) ON DELETE RESTRICT,
	CONSTRAINT fk_teaching_classes_subject_id FOREIGN KEY(subject_id, owner_id) REFERENCES subjects (id, owner_id) ON DELETE RESTRICT,
	CONSTRAINT teaching_classes_roster CHECK (json_typeof(roster) = 'array' AND json_array_length(roster) <= 200),
	CONSTRAINT teaching_classes_revision CHECK (revision > 0)
);
CREATE INDEX ix_teaching_classes_owner_id ON teaching_classes (owner_id);
CREATE INDEX ix_teaching_classes_section_id ON teaching_classes (section_id);
CREATE INDEX ix_teaching_classes_subject_id ON teaching_classes (subject_id);

-- The class an assessment was given to, and when papers are due.
ALTER TABLE assessments
  ADD COLUMN class_id UUID,
  ADD COLUMN due_at TIMESTAMP WITH TIME ZONE,
  ADD CONSTRAINT fk_assessments_class_id FOREIGN KEY(class_id, owner_id) REFERENCES teaching_classes (id, owner_id) ON DELETE RESTRICT;
CREATE INDEX ix_assessments_class_id ON assessments (class_id);

-- When the paper was handed in; "late" compares it with assessments.due_at.
ALTER TABLE submissions ADD COLUMN submitted_at TIMESTAMP WITH TIME ZONE;

CREATE TABLE calendar_events (
	title VARCHAR(80) NOT NULL,
	type VARCHAR(20) NOT NULL,
	starts_at TIMESTAMP WITH TIME ZONE NOT NULL,
	duration_min INTEGER NOT NULL,
	all_day BOOLEAN NOT NULL,
	class_id UUID,
	assessment_id UUID,
	notes TEXT NOT NULL,
	revision INTEGER NOT NULL,
	deleted_at TIMESTAMP WITH TIME ZONE,
	id UUID NOT NULL,
	owner_id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (id, owner_id),
	CONSTRAINT fk_calendar_events_class_id FOREIGN KEY(class_id, owner_id) REFERENCES teaching_classes (id, owner_id) ON DELETE RESTRICT,
	CONSTRAINT fk_calendar_events_assessment_id FOREIGN KEY(assessment_id, owner_id) REFERENCES assessments (id, owner_id) ON DELETE RESTRICT,
	CHECK (type IN ('exam', 'quiz', 'class', 'deadline', 'meeting', 'reminder')),
	CHECK (duration_min BETWEEN 0 AND 600),
	CONSTRAINT calendar_events_notes CHECK (length(notes) <= 500)
);
CREATE INDEX ix_calendar_events_owner_id ON calendar_events (owner_id);
CREATE INDEX ix_calendar_events_starts_at ON calendar_events (starts_at);

CREATE TABLE feedback_messages (
	message TEXT NOT NULL,
	app_version VARCHAR(40),
	platform VARCHAR(40),
	id UUID NOT NULL,
	owner_id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (id, owner_id),
	CONSTRAINT feedback_messages_length CHECK (length(message) BETWEEN 5 AND 2000)
);
CREATE INDEX ix_feedback_messages_owner_id ON feedback_messages (owner_id);

-- Incremental sync reads "changed since" per teacher.
CREATE INDEX ix_assessments_owner_updated ON assessments (owner_id, updated_at);
CREATE INDEX ix_submissions_owner_updated ON submissions (owner_id, updated_at);
CREATE INDEX ix_teaching_materials_owner_updated ON teaching_materials (owner_id, updated_at);
CREATE INDEX ix_teaching_classes_owner_updated ON teaching_classes (owner_id, updated_at);
CREATE INDEX ix_calendar_events_owner_updated ON calendar_events (owner_id, updated_at);

-- Same protections as every other table (see 0002_security.sql): only the backend role, only
-- the teacher's own rows, and owners must be real Supabase users.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['teaching_classes', 'calendar_events', 'feedback_messages'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, teachease_login', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO teachease_api', t);
    EXECUTE format('CREATE POLICY teacher_owns_record ON public.%I TO teachease_api
      USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()))', t);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (owner_id)
      REFERENCES auth.users(id) ON DELETE RESTRICT', t, t || '_owner_auth_fk');
  END LOOP;
END $$;

COMMIT;
