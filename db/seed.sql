-- Add a test user
INSERT INTO users (id, email, password_hash)
VALUES (
  gen_random_uuid(),
  'test@example.com',
  'hashed_password_123'  -- Replace with a real hash in production
)
ON CONFLICT (email) DO NOTHING;

-- Add a sample session and advice (adjust user_id if needed)
WITH selected_user AS (
  SELECT id FROM users WHERE email = 'test@example.com' LIMIT 1
)
INSERT INTO sessions (id, user_id, metadata)
VALUES (
  gen_random_uuid(),
  (SELECT id FROM selected_user),
  '{"topic": "communication", "length_minutes": 45}'
)
ON CONFLICT DO NOTHING;

-- Advice
WITH session_ref AS (
  SELECT id FROM sessions WHERE metadata ->> 'topic' = 'communication' LIMIT 1
)
INSERT INTO advice (id, session_id, summary)
VALUES (
  gen_random_uuid(),
  (SELECT id FROM session_ref),
  'Practice active listening and avoid interrupting your partner.'
)
ON CONFLICT DO NOTHING;
