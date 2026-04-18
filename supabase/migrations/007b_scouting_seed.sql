-- ============================================================
-- Migration 007b — Scouting Hub Seed Data (2026 Draft Class)
-- Imports 83 prospects from the Google Sheet scouting data.
-- Run AFTER 007_scouting_tables.sql.
-- ============================================================
-- This script uses your Supabase auth user ID (looked up by email).
-- It will only insert prospects for the authenticated account.
-- Safe to re-run: uses INSERT ... WHERE NOT EXISTS to skip duplicates.
-- ============================================================

DO $$
DECLARE
  uid uuid;
BEGIN
  -- Look up your user ID by email
  SELECT id INTO uid FROM auth.users WHERE email = 'bstefely@gmail.com' LIMIT 1;

  IF uid IS NULL THEN
    RAISE EXCEPTION 'User not found — make sure you are logged into the app first.';
  END IF;

  -- Insert charted prospects (have route counts from film study)
  INSERT INTO prospects (user_id, position, name, school, conference, draft_class_year, personal_rank, charting_decision)
  SELECT uid, 'WR', name, school, conference, 2026, rank, decision
  FROM (VALUES
    ( 1, 'Denzel Boston',       'Washington',        'Big 10',      'charted'),
    ( 2, 'Germie Bernard',      'Alabama',           'SEC',         'charted'),
    ( 3, 'Antonio Williams',    'Clemson',           'ACC',         'charted'),
    ( 4, 'Chris Brazzell II',   'Tennessee',         'SEC',         'charted'),
    ( 5, 'Jordyn Tyson',        'Arizona State',     'Big 12',      'charted'),
    ( 6, 'KC Concepcion',       'Texas A&M',         'SEC',         'charted'),
    ( 7, 'Makai Lemon',         'USC',               'Big 10',      'charted'),
    ( 8, 'Harrison Wallace III','Ole Miss',           'SEC',         'charted'),
    ( 9, 'Carnell Tate',        'Ohio State',        'Big 10',      'charted'),
    (10, 'Deion Burks',         'Oklahoma',          'SEC',         'charted'),
    (11, 'Lewis Bond',          'Boston College',    'ACC',         'charted'),
    (12, 'Malachi Fields',      'Notre Dame',        'Independents','charted'),
    (13, 'Omar Cooper Jr.',     'Indiana',           'Big 10',      'charted'),
    (14, 'Elijah Sarratt',      'Indiana',           'Big 10',      'charted'),
    (15, 'Brenen Thompson',     'Mississippi State', 'SEC',         'charted'),
    (16, 'Eric McAlister',      'TCU',               'Big 12',      'charted'),
    (17, 'Aaron Anderson',      'LSU',               'SEC',         'charted'),
    (18, 'Josh Cameron',        'Baylor',            'Big 12',      'charted'),
    (19, 'Ja''Kobi Lane',       'USC',               'Big 10',      'charted'),
    (20, 'Cortez Braham Jr.',   'Memphis',           'American',    'charted'),
    (21, 'Zachariah Branch',    'Georgia',           'SEC',         'charted'),
    (22, 'O''Mega Blake',       'Arkansas',          'SEC',         'charted'),
    (23, 'CJ Daniels',          'Miami',             'ACC',         'charted'),
    (24, 'Chris Bell',          'Louisville',        'ACC',         'charted'),
    (25, 'Chase Roberts',       'BYU',               'Big 12',      'charted'),
    (26, 'Jordan Hudson',       'SMU',               'ACC',         'charted'),
    (27, 'Caullin Lacy',        'Louisville',        'ACC',         'charted'),
    (28, 'Eric Rivers',         'Georgia Tech',      'ACC',         'charted'),
    (29, 'Caleb Douglas',       'Texas Tech',        'Big 12',      'charted'),
    (30, 'Kendrick Law',        'Kentucky',          'SEC',         'charted'),
    (31, 'Kevin Coleman Jr.',   'Missouri',          'SEC',         'charted'),
    (32, 'Romello Brinson',     'SMU',               'ACC',         'charted'),
    (33, 'Hank Beatty',         'Illinois',          'Big 10',      'charted'),
    (34, 'Cameron Dorner',      'North Texas',       'American',    'charted'),
    (35, 'Dane Key',            'Nebraska',          'Big 10',      'charted'),
    (36, 'Skyler Bell',         'Uconn',             'Independents','charted'),
    (37, 'Reggie Virgil',       'Texas Tech',        'Big 12',      'charted'),
    (38, 'Bryce Lance',         'North Dakota State','FCS',         'charted'),
    (39, 'Barion Brown',        'LSU',               'SEC',         'charted'),
    (40, 'Cyrus Allen',         'Cincinnati',        'Big 12',      'charted'),
    (41, 'Ted Hurst',           'Georgia State',     'Sun Belt',    'charted'),
    (42, 'De''Zhaun Stribling', 'Ole Miss',          'SEC',         'charted'),
    (43, 'Vinny Anthony II',    'Wisconsin',         'Big 10',      'charted'),
    (44, 'Zavion Thomas',       'LSU',               'SEC',         'charted'),
    (45, 'Devin Voisin',        'South Alabama',     'Sun Belt',    'charted'),
    (46, 'Eli Heidenreich',     'Navy',              'American',    'charted'),
    (47, 'Emmanuel Henderson',  'Kansas',            'Big 12',      'charted'),
    (48, 'Michael Wortham',     'Montana',           'FCS',         'charted'),
    (49, 'CJ Williams',         'Stanford',          'ACC',         'charted'),
    (50, 'Jeff Caldwell',       'Cincinnati',        'Big 12',      'charted'),
    -- Declared (tracked but not charted)
    (51, 'Gabriel Benyard',     'Kennesaw State',    'C-USA',       'declared'),
    (52, 'JJ Evans',            'Norfolk State',     'FCS',         'declared'),
    (53, 'Junior Vandeross III','Toledo',            'MAC',         'declared'),
    (54, 'Jaden Bradley',       'UNLV',              'MWC',         'declared'),
    (55, 'Kobe Prentice',       'Baylor',            'Big 12',      'declared'),
    (56, 'Colbie Young',        'Georgia',           'SEC',         'declared'),
    (57, 'Jalen Walthall',      'Incarnate Word',    'FCS',         'declared'),
    (58, 'Justus Ross-Simmons', 'Syracuse',          'ACC',         'declared'),
    (59, 'Javin Whatley',       'Arizona',           'Big 12',      'declared'),
    (60, 'Omari Kelly',         'Michigan State',    'Big 10',      'declared'),
    (61, 'Jalil Farooq',        'Maryland',          'Big 10',      'declared'),
    (62, 'Noah Thomas',         'Georgia',           'SEC',         'declared'),
    (63, 'Dillon Bell',         'Georgia',           'SEC',         'declared'),
    (64, 'Logan Loya',          'Minnesota',         'Big 10',      'declared'),
    (65, 'Jacob De Jesus',      'California',        'ACC',         'declared'),
    (66, 'Chris Hilton Jr.',    'LSU',               'SEC',         'declared'),
    (67, 'DT Sheffield',        'Rutgers',           'Big 10',      'declared'),
    (68, 'Donaven McCulley',    'Michigan',          'Big 10',      'declared'),
    (69, 'Rara Thomas',         'Troy',              'Sun Belt',    'declared'),
    (70, 'William Pauling',     'Notre Dame',        'Independents','declared'),
    (71, 'Wesley Grimes',       'North Carolina',    'ACC',         'declared'),
    (72, 'Squirrel White',      'Florida State',     'ACC',         'declared'),
    (73, 'Trebor Pena',         'Penn State',        'Big 10',      'declared'),
    (74, 'Malik Benson',        'Oregon',            'Big 10',      'declared'),
    (75, 'J. Michael Sturdivant','Florida',          'SEC',         'declared'),
    (76, 'Devonte Ross',        'Penn State',        'Big 10',      'declared'),
    (77, 'Ashtyn Hawkins',      'Baylor',            'Big 12',      'declared'),
    (78, 'Kaden Wetjen',        'Iowa',              'Big 10',      'declared'),
    (79, 'Malik Rutherford',    'Georgia Tech',      'ACC',         'declared'),
    (80, 'Camden Brown',        'Georgia Southern',  'Sun Belt',    'declared'),
    (81, 'Octavian Smith Jr.',  'Maryland',          'Big 10',      'declared'),
    (82, 'EJ Horton',           'Purdue',            'Big 10',      'declared'),
    (83, 'Tre Shackelford',     'Tulane',            'American',    'declared')
  ) AS t(rank, name, school, conference, decision)
  WHERE NOT EXISTS (
    SELECT 1 FROM prospects p2
    WHERE p2.user_id = uid AND p2.name = t.name AND p2.draft_class_year = 2026
  );

END $$;
