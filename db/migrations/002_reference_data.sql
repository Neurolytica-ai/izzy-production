-- 002_reference_data.sql
-- Fixed reference data: the 10 costing buckets (WP §5.2).
-- These are business constants, not master data, so they live in a migration
-- rather than the seed. Labels match SEED.buckets in the prototype exactly.

INSERT INTO buckets (key, label_he, sort_order) VALUES
  ('pah',       'עבודות פח',      1),
  ('misgarot',  'מסגרות',          2),
  ('hazraka',   'הזרקה',           3),
  ('panelim',   'פנלים',           4),
  ('hadbaka',   'הדבקה/ארגז',      5),
  ('ritum',     'ריתום',           6),
  ('dlatot',    'דלתות',           7),
  ('hashmal',   'חשמל',            8),
  ('psei',      'פסי קשירה/גמר',   9),
  ('hashlamot', 'השלמות',         10);
