-- The starting list the model assigns from. Admins add, merge and retire categories later.
INSERT INTO "task_categories" ("slug", "name", "requires_skilled", "skill", "risk_level", "min_verification_level") VALUES
  ('errand', 'Errand', false, NULL, 'low', 'basic'),
  ('parcel-drop', 'Parcel pickup and drop', false, NULL, 'low', 'basic'),
  ('carry-luggage', 'Carrying and luggage', false, NULL, 'low', 'basic'),
  ('shopping-pickup', 'Shopping and grocery pickup', false, NULL, 'low', 'basic'),
  ('queue-waiting', 'Waiting in a queue', false, NULL, 'low', 'basic'),
  ('wait-at-home', 'Waiting at home for a delivery', false, NULL, 'medium', 'verified'),
  ('shifting', 'Shifting and moving items', false, NULL, 'medium', 'verified'),
  ('cleaning', 'Cleaning', false, NULL, 'medium', 'verified'),
  ('event-setup', 'Event setup', false, NULL, 'low', 'verified'),
  ('elder-company', 'Company and help for elders', false, NULL, 'high', 'verified'),
  ('plumbing', 'Plumbing', true, 'plumbing', 'medium', 'verified'),
  ('electrical', 'Electrical work', true, 'electrical', 'high', 'verified'),
  ('carpentry', 'Carpentry', true, 'carpentry', 'medium', 'verified'),
  ('appliance-repair', 'Appliance repair', true, 'appliance-repair', 'medium', 'verified'),
  ('painting', 'Painting', true, 'painting', 'medium', 'verified'),
  ('tutoring', 'Tutoring', true, 'tutoring', 'medium', 'verified')
ON CONFLICT ("slug") DO NOTHING;
