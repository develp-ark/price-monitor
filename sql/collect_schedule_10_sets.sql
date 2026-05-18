-- 10세트 순환 스케줄 (day_of_week 컬럼 = 세트 번호 1~10)
-- Supabase SQL Editor에서 실행

ALTER TABLE public.collect_schedule
  DROP CONSTRAINT IF EXISTS collect_schedule_day_of_week_check;

ALTER TABLE public.collect_schedule
  ADD CONSTRAINT collect_schedule_day_of_week_check
  CHECK (day_of_week >= 1 AND day_of_week <= 10);

ALTER TABLE public.collect_status
  ADD COLUMN IF NOT EXISTS schedule_next_set INT DEFAULT 1;

COMMENT ON COLUMN public.collect_schedule.day_of_week IS '수집 세트 번호 (1~10), 요일 아님';
