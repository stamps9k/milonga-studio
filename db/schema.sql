-- Milonga Studio schema
--
-- Mirrors the TypeScript data model in src/libs/dance/*.mts:
--   DanceStep -> Pose -> Figure -> Sequence -> Dance
--
-- Normalization notes:
--   - Value objects with no independent identity outside their parent
--     (foot_states, partner_poses) use composite primary keys rather than
--     surrogate ids.
--   - Movement is a discriminated union (straight | arc) in the type
--     model. Rather than one row with a type column and a set of nullable
--     columns that only apply to one branch, each variant gets its own
--     child table keyed on movement_id, so no row can carry columns that
--     don't apply to its type.
--   - Ordering (DanceStep within a Figure, SequenceEntry within a
--     Sequence) has no implicit meaning in a SQL table, so both carry an
--     explicit ordinal column with a uniqueness constraint.
--
-- SQLite does not enforce foreign keys by default -- every connection
-- must run `PRAGMA foreign_keys = ON;` before use.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- Pose: resolved state of both partners at one instant.
-- (Pose itself has no scalar fields -- it's just an anchor id that
-- partner_poses hang off.)
-- ---------------------------------------------------------------------

CREATE TABLE poses (
	id INTEGER PRIMARY KEY
);

CREATE TABLE partner_poses (
	pose_id     INTEGER NOT NULL REFERENCES poses(id) ON DELETE CASCADE,
	partner     TEXT    NOT NULL CHECK (partner IN ('lead', 'follow')),
	orientation REAL    NOT NULL, -- degrees, frame/torso heading
	rise        REAL    NOT NULL, -- vertical displacement, floor units
	PRIMARY KEY (pose_id, partner)
);

CREATE TABLE foot_states (
	pose_id  INTEGER NOT NULL,
	partner  TEXT    NOT NULL,
	foot     TEXT    NOT NULL CHECK (foot IN ('left', 'right')),
	x        REAL    NOT NULL, -- floor position, floor units
	y        REAL    NOT NULL,
	weight   REAL    NOT NULL CHECK (weight >= 0 AND weight <= 1),
	PRIMARY KEY (pose_id, partner, foot),
	FOREIGN KEY (pose_id, partner) REFERENCES partner_poses(pose_id, partner) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------
-- Movement: how a foot travels from its previous position to this one.
-- Discriminated union -- one row in `movements` per step, exactly one
-- matching child row in movement_straight or movement_arc depending on
-- `type`. Enforced by trigger below rather than a plain CHECK, since
-- SQLite CHECK constraints can't reference other tables.
-- ---------------------------------------------------------------------

CREATE TABLE movements (
	id   INTEGER PRIMARY KEY,
	type TEXT NOT NULL CHECK (type IN ('straight', 'arc'))
);

CREATE TABLE movement_straight (
	movement_id INTEGER PRIMARY KEY REFERENCES movements(id) ON DELETE CASCADE,
	direction   REAL NOT NULL, -- degrees, heading of travel on the floor
	distance    REAL NOT NULL  -- floor units
);

CREATE TABLE movement_arc (
	movement_id INTEGER PRIMARY KEY REFERENCES movements(id) ON DELETE CASCADE,
	curvature   REAL NOT NULL CHECK (curvature != 0), -- signed 1/radius; 0 must be 'straight' instead
	arc_length  REAL NOT NULL
);

CREATE TRIGGER movement_straight_type_check
AFTER INSERT ON movement_straight
BEGIN
	SELECT RAISE(ABORT, 'movement_straight.movement_id must reference a movements row with type = straight')
	WHERE (SELECT type FROM movements WHERE id = NEW.movement_id) != 'straight';
END;

CREATE TRIGGER movement_arc_type_check
AFTER INSERT ON movement_arc
BEGIN
	SELECT RAISE(ABORT, 'movement_arc.movement_id must reference a movements row with type = arc')
	WHERE (SELECT type FROM movements WHERE id = NEW.movement_id) != 'arc';
END;

-- ---------------------------------------------------------------------
-- Figure: a named, reusable piece of choreography, defined in its own
-- local floor frame (starts at the origin, facing 0 degrees).
-- ---------------------------------------------------------------------

CREATE TABLE figures (
	id                INTEGER PRIMARY KEY,
	name              TEXT    NOT NULL,
	style             TEXT    NOT NULL, -- free-form tag: 'tango', 'waltz', 'blues', ...
	beats_per_measure INTEGER NOT NULL,
	beat_unit         INTEGER NOT NULL, -- e.g. 4 for quarter-note beats
	start_pose_id     INTEGER NOT NULL REFERENCES poses(id),
	end_pose_id       INTEGER NOT NULL REFERENCES poses(id)
);

CREATE TABLE dance_steps (
	id          INTEGER PRIMARY KEY,
	figure_id   INTEGER NOT NULL REFERENCES figures(id) ON DELETE CASCADE,
	step_index  INTEGER NOT NULL, -- position within figure.steps; SQL rows have no inherent order
	partner     TEXT    NOT NULL CHECK (partner IN ('lead', 'follow')),
	foot        TEXT    NOT NULL CHECK (foot IN ('left', 'right')),
	movement_id INTEGER NOT NULL REFERENCES movements(id),
	contact     TEXT    NOT NULL CHECK (contact IN ('floor', 'air')),
	weight      REAL    NOT NULL CHECK (weight >= 0 AND weight <= 1),
	orientation REAL    NOT NULL, -- degrees, absolute frame heading at end of step
	rise        REAL    NOT NULL,
	beat        REAL    NOT NULL, -- position within the measure
	duration    REAL    NOT NULL, -- in beats
	label       TEXT,
	UNIQUE (figure_id, step_index)
);

-- ---------------------------------------------------------------------
-- Sequence: an ordered chain of Figures placed on the floor.
-- ---------------------------------------------------------------------

CREATE TABLE floor_transforms (
	id       INTEGER PRIMARY KEY,
	x        REAL NOT NULL,
	y        REAL NOT NULL,
	rotation REAL NOT NULL -- degrees
);

CREATE TABLE sequences (
	id                  INTEGER PRIMARY KEY,
	name                TEXT    NOT NULL,
	start_transform_id  INTEGER NOT NULL REFERENCES floor_transforms(id)
);

CREATE TABLE sequence_entries (
	id                     INTEGER PRIMARY KEY,
	sequence_id            INTEGER NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
	entry_index            INTEGER NOT NULL, -- position within sequence.entries
	figure_id              INTEGER NOT NULL REFERENCES figures(id),
	transform_id           INTEGER NOT NULL REFERENCES floor_transforms(id),
	resolved_start_pose_id INTEGER NOT NULL REFERENCES poses(id),
	resolved_end_pose_id   INTEGER NOT NULL REFERENCES poses(id),
	UNIQUE (sequence_id, entry_index)
);

-- ---------------------------------------------------------------------
-- Dance: the top-level saved/shared record.
-- ---------------------------------------------------------------------

CREATE TABLE dances (
	id             INTEGER PRIMARY KEY,
	name           TEXT    NOT NULL,
	tempo          REAL    NOT NULL, -- bpm
	music          TEXT,
	notes          TEXT,
	created_at     TEXT    NOT NULL, -- ISO 8601
	updated_at     TEXT    NOT NULL,
	schema_version INTEGER NOT NULL,
	sequence_id    INTEGER NOT NULL REFERENCES sequences(id)
);
