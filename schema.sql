
CREATE TABLE IF NOT EXISTS players (
  player_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_name  TEXT NOT NULL UNIQUE COLLATE NOCASE,
  rfid_uid    TEXT UNIQUE,
  rank_title  TEXT NOT NULL DEFAULT 'Rookie',
  total_xp    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cases (
  case_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  title          TEXT NOT NULL,
  story          TEXT NOT NULL,
  difficulty     TEXT NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  time_limit_sec INTEGER NOT NULL DEFAULT 300,
  lives          INTEGER NOT NULL DEFAULT 3
);

CREATE TABLE IF NOT EXISTS game_sessions (
  session_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id        INTEGER NOT NULL REFERENCES players(player_id),
  case_id          INTEGER NOT NULL REFERENCES cases(case_id),
  mode             TEXT NOT NULL DEFAULT 'solo' CHECK (mode IN ('solo','hardware')),
  started_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_ms       INTEGER NOT NULL,
  ended_at         TEXT,
  time_limit_sec   INTEGER NOT NULL,
  max_lives        INTEGER NOT NULL,
  lives_left       INTEGER NOT NULL,
  current_stage    INTEGER NOT NULL DEFAULT 1,
  hint_penalty_sec INTEGER NOT NULL DEFAULT 0,
  time_taken_sec   INTEGER,
  score            INTEGER NOT NULL DEFAULT 0,
  xp_earned        INTEGER NOT NULL DEFAULT 0,
  result           TEXT NOT NULL DEFAULT 'active' CHECK (result IN ('active','win','lose','abandoned')),
  end_reason       TEXT,
  achievements_json TEXT NOT NULL DEFAULT '[]'
);

-- Puzzles are generated per session (randomised), answers never leave the server
CREATE TABLE IF NOT EXISTS session_puzzles (
  sp_id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id     INTEGER NOT NULL REFERENCES game_sessions(session_id) ON DELETE CASCADE,
  stage_no       INTEGER NOT NULL,
  puzzle_type    TEXT NOT NULL CHECK (puzzle_type IN ('binary_decode','logic_gate','truth_table','boss_adder','final_code')),
  concept        TEXT NOT NULL,
  input_mode     TEXT NOT NULL,
  question       TEXT NOT NULL,
  correct_answer TEXT NOT NULL,
  hint           TEXT,
  explanation    TEXT,
  payload_json   TEXT NOT NULL DEFAULT '{}',
  reveal_bit     INTEGER,
  hint_used      INTEGER NOT NULL DEFAULT 0,
  solved         INTEGER NOT NULL DEFAULT 0,
  UNIQUE (session_id, stage_no)
);

CREATE TABLE IF NOT EXISTS attempts (
  attempt_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    INTEGER NOT NULL REFERENCES game_sessions(session_id) ON DELETE CASCADE,
  sp_id         INTEGER NOT NULL REFERENCES session_puzzles(sp_id) ON DELETE CASCADE,
  player_answer TEXT NOT NULL,
  is_correct    INTEGER NOT NULL,
  hint_used     INTEGER NOT NULL DEFAULT 0,
  attempted_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS achievements (
  achievement_id INTEGER PRIMARY KEY AUTOINCREMENT,
  code           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL,
  xp_reward      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS player_achievements (
  player_id      INTEGER NOT NULL REFERENCES players(player_id),
  achievement_id INTEGER NOT NULL REFERENCES achievements(achievement_id),
  earned_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (player_id, achievement_id)
);

-- Raw telemetry from the DLD hardware box (FSM state, lives, timer, comparator)
CREATE TABLE IF NOT EXISTS hardware_events (
  event_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER REFERENCES game_sessions(session_id) ON DELETE SET NULL,
  fsm_state   TEXT,
  lives       INTEGER,
  timer_sec   INTEGER,
  code_bits   TEXT,
  comparator  INTEGER,
  raw_json    TEXT,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_player ON game_sessions(player_id, result);
CREATE INDEX IF NOT EXISTS idx_attempts_session ON attempts(session_id);
CREATE INDEX IF NOT EXISTS idx_sp_session ON session_puzzles(session_id);

CREATE TABLE IF NOT EXISTS matches (
  code       TEXT PRIMARY KEY,
  case_id    INTEGER NOT NULL,
  a_player   INTEGER NOT NULL,
  a_session  INTEGER,
  b_player   INTEGER,
  b_session  INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
