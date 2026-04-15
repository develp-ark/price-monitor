-- Run in Supabase SQL editor (once)

CREATE TABLE IF NOT EXISTS public.collect_schedule (
  id BIGSERIAL PRIMARY KEY,
  day_of_week INT NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  sku_id TEXT NOT NULL REFERENCES public.sku_list(sku_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(day_of_week, sku_id)
);

CREATE INDEX IF NOT EXISTS idx_collect_schedule_day ON public.collect_schedule(day_of_week);
CREATE INDEX IF NOT EXISTS idx_collect_schedule_sku ON public.collect_schedule(sku_id);

CREATE TABLE IF NOT EXISTS public.collect_status (
  id BIGSERIAL PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'idle',
  total INT NOT NULL DEFAULT 0,
  current INT NOT NULL DEFAULT 0,
  success INT NOT NULL DEFAULT 0,
  fail INT NOT NULL DEFAULT 0,
  current_sku_name TEXT,
  started_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_collect_status_updated_at ON public.collect_status(updated_at DESC);
