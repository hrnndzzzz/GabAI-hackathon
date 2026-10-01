-- Run as the Supabase migration administrator. Never use this administrator in FastAPI.
BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'teachease_api') THEN
    CREATE ROLE teachease_api NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'teachease_login') THEN
    CREATE ROLE teachease_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
GRANT teachease_api TO teachease_login;
GRANT USAGE ON SCHEMA public, auth TO teachease_api;
GRANT EXECUTE ON FUNCTION auth.uid() TO teachease_api;

-- No password is checked into this repository. Provision teachease_login's password separately.
-- Only the backend login can SET ROLE teachease_api. Supabase REST users receive no table grants:
-- direct REST writes would bypass scoring/approval validation even with same-owner RLS.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'teacher_profiles','academic_years','terms','grade_levels','sections','students','enrollments',
    'subjects','competencies','assessments','answer_key_versions','assessment_questions',
    'question_competencies','submissions','submission_answers','item_results','score_adjustments',
    'teaching_materials','expected_assessments','consultation_reports','upload_receipts','ai_rate_buckets'
  ] LOOP
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

-- Immutable key contents, provenance and approved grade fields, even if backend code regresses.
CREATE FUNCTION public.teachease_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_TABLE_NAME = 'answer_key_versions' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Answer key history cannot be deleted' USING ERRCODE='23514';
    END IF;
    IF NEW.id <> OLD.id OR NEW.owner_id <> OLD.owner_id OR NEW.assessment_id <> OLD.assessment_id
      OR NEW.version <> OLD.version OR (OLD.verified AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)) THEN
      RAISE EXCEPTION 'Answer key versions are immutable after verification' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME IN ('assessment_questions','question_competencies','score_adjustments','upload_receipts') THEN
    RAISE EXCEPTION 'Historical evidence is append-only' USING ERRCODE='23514';
  ELSIF TG_TABLE_NAME = 'submissions' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Submission history cannot be deleted' USING ERRCODE='23514';
    END IF;
    IF OLD.status = 'approved' AND
      (to_jsonb(NEW) - ARRAY['student_id','enrollment_id','revision','updated_at']) IS DISTINCT FROM
      (to_jsonb(OLD) - ARRAY['student_id','enrollment_id','revision','updated_at']) THEN
      RAISE EXCEPTION 'Approved scores are immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.student_id IS NOT NULL AND (NEW.student_id IS DISTINCT FROM OLD.student_id
       OR NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id) THEN
      RAISE EXCEPTION 'Historical student association is immutable' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME IN ('submission_answers','item_results') THEN
    IF EXISTS(SELECT 1 FROM public.submissions WHERE id=OLD.submission_id AND status='approved') THEN
      RAISE EXCEPTION 'Approved item evidence is immutable' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME IN ('teaching_materials','consultation_reports') THEN
    IF NEW.provenance::jsonb IS DISTINCT FROM OLD.provenance::jsonb
       OR NEW.original_content::jsonb IS DISTINCT FROM OLD.original_content::jsonb THEN
      RAISE EXCEPTION 'Generation provenance is immutable' USING ERRCODE='23514';
    END IF;
    IF TG_TABLE_NAME = 'consultation_reports' THEN
      IF NEW.snapshot::jsonb IS DISTINCT FROM OLD.snapshot::jsonb THEN
        RAISE EXCEPTION 'Consultation evidence snapshot is immutable' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.teachease_guard() FROM PUBLIC;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['answer_key_versions','assessment_questions','question_competencies',
    'score_adjustments','upload_receipts','submissions','submission_answers','item_results'] LOOP
    EXECUTE format('CREATE TRIGGER protect_history BEFORE UPDATE OR DELETE ON public.%I
      FOR EACH ROW EXECUTE FUNCTION public.teachease_guard()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['teaching_materials','consultation_reports'] LOOP
    EXECUTE format('CREATE TRIGGER protect_provenance BEFORE UPDATE ON public.%I
      FOR EACH ROW EXECUTE FUNCTION public.teachease_guard()', t);
  END LOOP;
END $$;

ALTER TABLE public.answer_key_versions ADD CONSTRAINT verified_key_actor CHECK (
  (NOT verified AND verified_by IS NULL AND verified_at IS NULL) OR
  (verified AND verified_by = owner_id AND verified_at IS NOT NULL));
ALTER TABLE public.submissions ADD CONSTRAINT approval_actor CHECK (
  (status = 'draft' AND approved_by IS NULL AND approved_at IS NULL) OR
  (status = 'approved' AND approved_by = owner_id AND approved_at IS NOT NULL));
ALTER TABLE public.score_adjustments ADD CONSTRAINT adjustment_actor CHECK (actor_id = owner_id AND length(trim(reason)) >= 3);
ALTER TABLE public.teacher_profiles ADD CONSTRAINT profile_identity CHECK (id = owner_id);

-- No Storage bucket is provisioned in this release. OCR images are transient and uploads work without them.
-- Optional retained-image storage must be private and have owner policies before being enabled.
COMMIT;
