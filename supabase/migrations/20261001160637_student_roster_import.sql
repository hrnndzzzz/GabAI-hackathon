-- Incremental migration: existing student IDs, local identifiers and history are preserved.
-- Existing forced owner RLS and backend-only table grants also cover these columns.
I do not have access to this projectBEGIN;
ALTER TABLE public.students ADD COLUMN student_number varchar(120);
ALTER TABLE public.students ADD COLUMN email varchar(254);
ALTER TABLE public.students ADD CONSTRAINT uq_students_owner_number UNIQUE (owner_id, student_number);
ALTER TABLE public.students ADD CONSTRAINT student_number_not_blank
  CHECK (student_number IS NULL OR length(trim(student_number)) > 0);
COMMENT ON COLUMN public.students.student_number IS
  'Teacher-scoped, case-sensitive identifier. Store as text to preserve leading zeros.';
COMMENT ON COLUMN public.students.email IS
  'Student contact data. Not a Supabase Auth account; roster imports send no emails.';
COMMIT;
