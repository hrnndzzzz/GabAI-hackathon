-- Generated from app/models.py for review only. Do not apply: databases are built by the
-- numbered files in supabase/migrations, which must not be edited once applied.
BEGIN;

CREATE TABLE academic_years (
	name VARCHAR(120) NOT NULL, 
	starts_on DATE NOT NULL, 
	ends_on DATE NOT NULL, 
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (id, owner_id), 
	CHECK (ends_on >= starts_on)
);

CREATE INDEX ix_academic_years_owner_id ON academic_years (owner_id);

CREATE TABLE ai_rate_buckets (
	owner_id UUID NOT NULL, 
	bucket INTEGER NOT NULL, 
	count INTEGER NOT NULL, 
	PRIMARY KEY (owner_id)
);

CREATE TABLE feedback_messages (
	message TEXT NOT NULL, 
	app_version VARCHAR(40), 
	platform VARCHAR(40), 
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (id, owner_id)
);

CREATE INDEX ix_feedback_messages_owner_id ON feedback_messages (owner_id);

CREATE TABLE grade_levels (
	name VARCHAR(120) NOT NULL, 
	level VARCHAR(20), 
	grade INTEGER, 
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (id, owner_id), 
	UNIQUE (owner_id, level, grade), 
	CHECK (level IS NULL OR level IN ('elementary', 'highschool', 'college')), 
	CHECK ((level IS NULL AND grade IS NULL) OR (level = 'elementary' AND grade BETWEEN 0 AND 6) OR (level = 'highschool' AND grade BETWEEN 7 AND 12) OR (level = 'college' AND grade BETWEEN 1 AND 4))
);

CREATE INDEX ix_grade_levels_owner_id ON grade_levels (owner_id);

CREATE TABLE students (
	display_name VARCHAR(120) NOT NULL, 
	local_identifier VARCHAR(120), 
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (id, owner_id)
);

CREATE INDEX ix_students_owner_id ON students (owner_id);

CREATE TABLE subjects (
	name VARCHAR(120) NOT NULL, 
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (id, owner_id)
);

CREATE INDEX ix_subjects_owner_id ON subjects (owner_id);

CREATE TABLE teacher_profiles (
	display_name VARCHAR(120) NOT NULL, 
	full_name VARCHAR(120), 
	school_name VARCHAR(160), 
	avatar_style VARCHAR(10) NOT NULL, 
	avatar_color VARCHAR(7), 
	avatar_pattern VARCHAR(20), 
	avatar_image BYTEA, 
	avatar_updated_at TIMESTAMP WITH TIME ZONE, 
	preferences JSON NOT NULL, 
	preferences_updated_at TIMESTAMP WITH TIME ZONE, 
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (id, owner_id), 
	UNIQUE (owner_id), 
	CHECK (avatar_style IN ('initials', 'pattern', 'photo'))
);

CREATE INDEX ix_teacher_profiles_owner_id ON teacher_profiles (owner_id);

CREATE TABLE teaching_materials (
	kind VARCHAR(30) NOT NULL, 
	content JSON NOT NULL, 
	original_content JSON NOT NULL, 
	provenance JSON NOT NULL, 
	revision INTEGER NOT NULL, 
	status VARCHAR(20) NOT NULL, 
	reviewed_by UUID, 
	reviewed_at TIMESTAMP WITH TIME ZONE, 
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (id, owner_id)
);

CREATE INDEX ix_teaching_materials_owner_id ON teaching_materials (owner_id);

CREATE TABLE upload_receipts (
	kind VARCHAR(30) NOT NULL, 
	payload_hash VARCHAR(64) NOT NULL, 
	response JSON NOT NULL, 
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (id, owner_id)
);

CREATE INDEX ix_upload_receipts_owner_id ON upload_receipts (owner_id);

CREATE TABLE competencies (
	name VARCHAR(120) NOT NULL, 
	subject_id UUID NOT NULL, 
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (id, owner_id), 
	CONSTRAINT fk_competencies_subject_id FOREIGN KEY(subject_id, owner_id) REFERENCES subjects (id, owner_id) ON DELETE RESTRICT
);

CREATE INDEX ix_competencies_owner_id ON competencies (owner_id);

CREATE INDEX ix_competencies_subject_id ON competencies (subject_id);

CREATE TABLE sections (
	name VARCHAR(120) NOT NULL, 
	grade_level_id UUID NOT NULL, 
	academic_year_id UUID NOT NULL, 
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (id, owner_id), 
	CONSTRAINT fk_sections_grade_level_id FOREIGN KEY(grade_level_id, owner_id) REFERENCES grade_levels (id, owner_id) ON DELETE RESTRICT, 
	CONSTRAINT fk_sections_academic_year_id FOREIGN KEY(academic_year_id, owner_id) REFERENCES academic_years (id, owner_id) ON DELETE RESTRICT
);

CREATE INDEX ix_sections_academic_year_id ON sections (academic_year_id);

CREATE INDEX ix_sections_grade_level_id ON sections (grade_level_id);

CREATE INDEX ix_sections_owner_id ON sections (owner_id);

CREATE TABLE terms (
	name VARCHAR(120) NOT NULL, 
	academic_year_id UUID NOT NULL, 
	starts_on DATE NOT NULL, 
	ends_on DATE NOT NULL, 
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (id, owner_id), 
	CONSTRAINT fk_terms_academic_year_id FOREIGN KEY(academic_year_id, owner_id) REFERENCES academic_years (id, owner_id) ON DELETE RESTRICT, 
	CHECK (ends_on >= starts_on)
);

CREATE INDEX ix_terms_academic_year_id ON terms (academic_year_id);

CREATE INDEX ix_terms_owner_id ON terms (owner_id);

CREATE TABLE consultation_reports (
	student_id UUID NOT NULL, 
	subject_id UUID NOT NULL, 
	term_id UUID NOT NULL, 
	snapshot JSON NOT NULL, 
	content JSON NOT NULL, 
	original_content JSON NOT NULL, 
	provenance JSON NOT NULL, 
	teacher_notes TEXT NOT NULL, 
	status VARCHAR(20) NOT NULL, 
	revision INTEGER NOT NULL, 
	approved_by UUID, 
	approved_at TIMESTAMP WITH TIME ZONE, 
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (id, owner_id), 
	CONSTRAINT fk_consultation_reports_student_id FOREIGN KEY(student_id, owner_id) REFERENCES students (id, owner_id) ON DELETE RESTRICT, 
	CONSTRAINT fk_consultation_reports_subject_id FOREIGN KEY(subject_id, owner_id) REFERENCES subjects (id, owner_id) ON DELETE RESTRICT, 
	CONSTRAINT fk_consultation_reports_term_id FOREIGN KEY(term_id, owner_id) REFERENCES terms (id, owner_id) ON DELETE RESTRICT
);

CREATE INDEX ix_consultation_reports_owner_id ON consultation_reports (owner_id);

CREATE INDEX ix_consultation_reports_student_id ON consultation_reports (student_id);

CREATE TABLE enrollments (
	student_id UUID NOT NULL, 
	section_id UUID NOT NULL, 
	starts_on DATE NOT NULL, 
	ends_on DATE, 
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (id, owner_id), 
	CONSTRAINT fk_enrollments_student_id FOREIGN KEY(student_id, owner_id) REFERENCES students (id, owner_id) ON DELETE RESTRICT, 
	CONSTRAINT fk_enrollments_section_id FOREIGN KEY(section_id, owner_id) REFERENCES sections (id, owner_id) ON DELETE RESTRICT, 
	CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE INDEX ix_enrollments_owner_id ON enrollments (owner_id);

CREATE INDEX ix_enrollments_section_id ON enrollments (section_id);

CREATE INDEX ix_enrollments_student_id ON enrollments (student_id);

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
	CONSTRAINT fk_teaching_classes_subject_id FOREIGN KEY(subject_id, owner_id) REFERENCES subjects (id, owner_id) ON DELETE RESTRICT
);

CREATE INDEX ix_teaching_classes_owner_id ON teaching_classes (owner_id);

CREATE INDEX ix_teaching_classes_section_id ON teaching_classes (section_id);

CREATE INDEX ix_teaching_classes_subject_id ON teaching_classes (subject_id);

CREATE TABLE assessments (
	title VARCHAR(200) NOT NULL, 
	description TEXT, 
	template_id VARCHAR(100) NOT NULL, 
	subject_id UUID, 
	term_id UUID, 
	assessment_date DATE NOT NULL, 
	category VARCHAR(80), 
	archived BOOLEAN NOT NULL, 
	class_id UUID, 
	due_at TIMESTAMP WITH TIME ZONE, 
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (id, owner_id), 
	CONSTRAINT fk_assessments_subject_id FOREIGN KEY(subject_id, owner_id) REFERENCES subjects (id, owner_id) ON DELETE RESTRICT, 
	CONSTRAINT fk_assessments_term_id FOREIGN KEY(term_id, owner_id) REFERENCES terms (id, owner_id) ON DELETE RESTRICT, 
	CONSTRAINT fk_assessments_class_id FOREIGN KEY(class_id, owner_id) REFERENCES teaching_classes (id, owner_id) ON DELETE RESTRICT
);

CREATE INDEX ix_assessments_class_id ON assessments (class_id);

CREATE INDEX ix_assessments_owner_id ON assessments (owner_id);

CREATE INDEX ix_assessments_subject_id ON assessments (subject_id);

CREATE INDEX ix_assessments_term_id ON assessments (term_id);

CREATE TABLE answer_key_versions (
	assessment_id UUID NOT NULL, 
	version INTEGER NOT NULL, 
	verified BOOLEAN NOT NULL, 
	verified_by UUID, 
	verified_at TIMESTAMP WITH TIME ZONE, 
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (id, owner_id), 
	CONSTRAINT fk_answer_key_versions_assessment_id FOREIGN KEY(assessment_id, owner_id) REFERENCES assessments (id, owner_id) ON DELETE RESTRICT, 
	UNIQUE (assessment_id, version), 
	CHECK (version > 0)
);

CREATE INDEX ix_answer_key_versions_assessment_id ON answer_key_versions (assessment_id);

CREATE INDEX ix_answer_key_versions_owner_id ON answer_key_versions (owner_id);

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
	CHECK (duration_min BETWEEN 0 AND 600)
);

CREATE INDEX ix_calendar_events_owner_id ON calendar_events (owner_id);

CREATE INDEX ix_calendar_events_starts_at ON calendar_events (starts_at);

CREATE TABLE expected_assessments (
	assessment_id UUID NOT NULL, 
	enrollment_id UUID NOT NULL, 
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (id, owner_id), 
	CONSTRAINT fk_expected_assessments_assessment_id FOREIGN KEY(assessment_id, owner_id) REFERENCES assessments (id, owner_id) ON DELETE RESTRICT, 
	CONSTRAINT fk_expected_assessments_enrollment_id FOREIGN KEY(enrollment_id, owner_id) REFERENCES enrollments (id, owner_id) ON DELETE RESTRICT, 
	UNIQUE (assessment_id, enrollment_id)
);

CREATE INDEX ix_expected_assessments_assessment_id ON expected_assessments (assessment_id);

CREATE INDEX ix_expected_assessments_enrollment_id ON expected_assessments (enrollment_id);

CREATE INDEX ix_expected_assessments_owner_id ON expected_assessments (owner_id);

CREATE TABLE assessment_questions (
	answer_key_id UUID NOT NULL, 
	number INTEGER NOT NULL, 
	kind VARCHAR(24) NOT NULL, 
	points NUMERIC(10, 2) NOT NULL, 
	correct_answer VARCHAR(200), 
	alternatives JSON NOT NULL, 
	choices JSON NOT NULL, 
	rubric TEXT, 
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (id, owner_id), 
	CONSTRAINT fk_assessment_questions_answer_key_id FOREIGN KEY(answer_key_id, owner_id) REFERENCES answer_key_versions (id, owner_id) ON DELETE RESTRICT, 
	UNIQUE (answer_key_id, number), 
	CHECK (number > 0 AND points > 0), 
	CHECK (kind IN ('multiple_choice', 'true_false', 'essay'))
);

CREATE INDEX ix_assessment_questions_answer_key_id ON assessment_questions (answer_key_id);

CREATE INDEX ix_assessment_questions_owner_id ON assessment_questions (owner_id);

CREATE TABLE submissions (
	assessment_id UUID NOT NULL, 
	answer_key_id UUID NOT NULL, 
	student_label VARCHAR(120) NOT NULL, 
	student_id UUID, 
	enrollment_id UUID, 
	source VARCHAR(20) NOT NULL, 
	status VARCHAR(20) NOT NULL, 
	revision INTEGER NOT NULL, 
	automatic_score NUMERIC(10, 2) NOT NULL, 
	final_score NUMERIC(10, 2) NOT NULL, 
	possible_score NUMERIC(10, 2) NOT NULL, 
	approved_by UUID, 
	approved_at TIMESTAMP WITH TIME ZONE, 
	local_approved_at TIMESTAMP WITH TIME ZONE, 
	submitted_at TIMESTAMP WITH TIME ZONE, 
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (id, owner_id), 
	CONSTRAINT fk_submissions_assessment_id FOREIGN KEY(assessment_id, owner_id) REFERENCES assessments (id, owner_id) ON DELETE RESTRICT, 
	CONSTRAINT fk_submissions_answer_key_id FOREIGN KEY(answer_key_id, owner_id) REFERENCES answer_key_versions (id, owner_id) ON DELETE RESTRICT, 
	CONSTRAINT fk_submissions_student_id FOREIGN KEY(student_id, owner_id) REFERENCES students (id, owner_id) ON DELETE RESTRICT, 
	CONSTRAINT fk_submissions_enrollment_id FOREIGN KEY(enrollment_id, owner_id) REFERENCES enrollments (id, owner_id) ON DELETE RESTRICT, 
	CHECK (status IN ('draft', 'approved')), 
	CHECK (source IN ('on_device', 'gemini', 'manual')), 
	CHECK (automatic_score >= 0 AND final_score >= 0 AND final_score <= possible_score)
);

CREATE INDEX ix_submissions_answer_key_id ON submissions (answer_key_id);

CREATE INDEX ix_submissions_assessment_id ON submissions (assessment_id);

CREATE INDEX ix_submissions_owner_id ON submissions (owner_id);

CREATE INDEX ix_submissions_student_id ON submissions (student_id);

CREATE TABLE item_results (
	submission_id UUID NOT NULL, 
	question_id UUID NOT NULL, 
	number INTEGER NOT NULL, 
	resolved BOOLEAN NOT NULL, 
	automatic_score NUMERIC(10, 2), 
	adjusted_score NUMERIC(10, 2), 
	final_score NUMERIC(10, 2), 
	possible_score NUMERIC(10, 2) NOT NULL, 
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (id, owner_id), 
	CONSTRAINT fk_item_results_submission_id FOREIGN KEY(submission_id, owner_id) REFERENCES submissions (id, owner_id) ON DELETE RESTRICT, 
	CONSTRAINT fk_item_results_question_id FOREIGN KEY(question_id, owner_id) REFERENCES assessment_questions (id, owner_id) ON DELETE RESTRICT, 
	UNIQUE (submission_id, number), 
	CHECK (final_score IS NULL OR (final_score >= 0 AND final_score <= possible_score))
);

CREATE INDEX ix_item_results_owner_id ON item_results (owner_id);

CREATE INDEX ix_item_results_submission_id ON item_results (submission_id);

CREATE TABLE question_competencies (
	question_id UUID NOT NULL, 
	competency_id UUID NOT NULL, 
	competency_name VARCHAR(120) NOT NULL, 
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (id, owner_id), 
	CONSTRAINT fk_question_competencies_question_id FOREIGN KEY(question_id, owner_id) REFERENCES assessment_questions (id, owner_id) ON DELETE RESTRICT, 
	CONSTRAINT fk_question_competencies_competency_id FOREIGN KEY(competency_id, owner_id) REFERENCES competencies (id, owner_id) ON DELETE RESTRICT, 
	UNIQUE (question_id, competency_id)
);

CREATE INDEX ix_question_competencies_owner_id ON question_competencies (owner_id);

CREATE INDEX ix_question_competencies_question_id ON question_competencies (question_id);

CREATE TABLE score_adjustments (
	submission_id UUID NOT NULL, 
	number INTEGER NOT NULL, 
	score NUMERIC(10, 2) NOT NULL, 
	reason TEXT NOT NULL, 
	actor_id UUID NOT NULL, 
	sequence INTEGER NOT NULL, 
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (id, owner_id), 
	CONSTRAINT fk_score_adjustments_submission_id FOREIGN KEY(submission_id, owner_id) REFERENCES submissions (id, owner_id) ON DELETE RESTRICT, 
	UNIQUE (submission_id, sequence), 
	CHECK (score >= 0)
);

CREATE INDEX ix_score_adjustments_owner_id ON score_adjustments (owner_id);

CREATE INDEX ix_score_adjustments_submission_id ON score_adjustments (submission_id);

CREATE TABLE submission_answers (
	submission_id UUID NOT NULL, 
	number INTEGER NOT NULL, 
	state VARCHAR(24) NOT NULL, 
	value TEXT, 
	extracted JSON, 
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (id, owner_id), 
	CONSTRAINT fk_submission_answers_submission_id FOREIGN KEY(submission_id, owner_id) REFERENCES submissions (id, owner_id) ON DELETE RESTRICT, 
	UNIQUE (submission_id, number), 
	CHECK (state IN ('recognized','blank_candidate','ambiguous','unreadable','confirmed','confirmed_blank'))
);

CREATE INDEX ix_submission_answers_owner_id ON submission_answers (owner_id);

CREATE INDEX ix_submission_answers_submission_id ON submission_answers (submission_id);

COMMIT;
