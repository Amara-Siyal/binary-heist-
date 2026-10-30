-- Seed data (safe to run repeatedly: INSERT OR IGNORE)
INSERT OR IGNORE INTO cases (case_id,title,story,difficulty,time_limit_sec,lives) VALUES (1,'The Stolen Core','The Digital Core has been stolen and sealed inside the vault. Decode the thief''s binary trail, break each logic lock and recover the final code before security locks everything down.','easy',300,3);
INSERT OR IGNORE INTO cases (case_id,title,story,difficulty,time_limit_sec,lives) VALUES (2,'The Midnight Server Room','An intruder wiped the logs of a downtown server room at midnight. Only fragments of gate logic remain. Reconstruct them to open the maintenance vault.','medium',240,3);
INSERT OR IGNORE INTO cases (case_id,title,story,difficulty,time_limit_sec,lives) VALUES (3,'Operation Zero Day','A zero-day exploit is draining the mainframe. A firewall guardian protects the kill-switch vault. Outwit its adder circuits fast; there is little room for error.','hard',180,2);
INSERT OR IGNORE INTO achievements (achievement_id,code,name,description,xp_reward) VALUES (1,'FIRST_CASE','Case Closed','Solve your first case.',100);
INSERT OR IGNORE INTO achievements (achievement_id,code,name,description,xp_reward) VALUES (2,'NO_LIVES_LOST','No Lives Lost','Win without losing a single life.',150);
INSERT OR IGNORE INTO achievements (achievement_id,code,name,description,xp_reward) VALUES (3,'SPEED_CRACKER','Speed Cracker','Crack the vault in under 2 minutes.',200);
INSERT OR IGNORE INTO achievements (achievement_id,code,name,description,xp_reward) VALUES (4,'XOR_MASTER','XOR Master','Answer every XOR puzzle correctly in a win.',150);
INSERT OR IGNORE INTO achievements (achievement_id,code,name,description,xp_reward) VALUES (5,'NO_HINTS','Pure Logic','Win without using any hints.',100);
INSERT OR IGNORE INTO achievements (achievement_id,code,name,description,xp_reward) VALUES (6,'BOSS_SLAYER','Firewall Slayer','Defeat the boss on the first try.',200);
