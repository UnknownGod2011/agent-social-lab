"""Short SQLite transactions; external model calls never hold a database lock."""
import copy
import json
import os
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from engine.reducer import reduce_event
from engine.world import digest, initial_state


def now():
    return datetime.now(timezone.utc).isoformat()


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


class Store:
    def __init__(self, path="data/lab.sqlite3", *, exclusive=False):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.process_lock = None
        if exclusive:
            self.process_lock = open(str(path) + ".server.lock", "a+b")
            self.process_lock.seek(0, 2)
            if self.process_lock.tell() == 0:
                self.process_lock.write(b"0")
                self.process_lock.flush()
            self.process_lock.seek(0)
            try:
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(self.process_lock.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(self.process_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                self.process_lock.close()
                raise RuntimeError("Only one server process may own a lab database. Stop the other server or choose another LAB_DB.") from None
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        self.db.executescript("""
        PRAGMA journal_mode=WAL;
        PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS runs (
          id TEXT PRIMARY KEY, config_json TEXT NOT NULL, config_hash TEXT NOT NULL,
          initial_state_hash TEXT NOT NULL, created_at TEXT NOT NULL,
          state_json TEXT NOT NULL, seq INTEGER NOT NULL DEFAULT 0,
          next_due TEXT, retry_at TEXT, control TEXT, stop_day INTEGER,
          lease_owner TEXT, lease_until TEXT
        );
        CREATE TABLE IF NOT EXISTS events (
          event_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id),
          seq INTEGER NOT NULL, department_id TEXT, virtual_day INTEGER NOT NULL,
          agent_id TEXT, channel TEXT, task_id TEXT, event_type TEXT NOT NULL,
          severity TEXT NOT NULL, envelope_json TEXT NOT NULL,
          UNIQUE(run_id,seq)
        );
        CREATE INDEX IF NOT EXISTS events_run_seq ON events(run_id,seq);
        CREATE TABLE IF NOT EXISTS messages (
          event_id TEXT PRIMARY KEY REFERENCES events(event_id), run_id TEXT NOT NULL,
          seq INTEGER NOT NULL, department_id TEXT, virtual_day INTEGER,
          agent_id TEXT, channel TEXT, task_id TEXT, text TEXT NOT NULL,
          visibility TEXT NOT NULL, recipient_id TEXT
        );
        CREATE TABLE IF NOT EXISTS snapshots (
          run_id TEXT NOT NULL REFERENCES runs(id), seq INTEGER NOT NULL,
          state_json TEXT NOT NULL, state_hash TEXT NOT NULL,
          PRIMARY KEY(run_id,seq)
        );
        CREATE TABLE IF NOT EXISTS day_jobs (
          run_id TEXT NOT NULL, virtual_day INTEGER NOT NULL, started_at TEXT NOT NULL,
          PRIMARY KEY(run_id,virtual_day)
        );
        CREATE TRIGGER IF NOT EXISTS immutable_events_update BEFORE UPDATE ON events
          BEGIN SELECT RAISE(ABORT,'events are append-only'); END;
        CREATE TRIGGER IF NOT EXISTS immutable_events_delete BEFORE DELETE ON events
          BEGIN SELECT RAISE(ABORT,'events are append-only'); END;
        CREATE TRIGGER IF NOT EXISTS immutable_messages_update BEFORE UPDATE ON messages
          BEGIN SELECT RAISE(ABORT,'messages are append-only'); END;
        CREATE TRIGGER IF NOT EXISTS immutable_messages_delete BEFORE DELETE ON messages
          BEGIN SELECT RAISE(ABORT,'messages are append-only'); END;
        """)
        self.db.commit()

    def create(self, config):
        run_id = uuid.uuid4().hex[:12]
        state = initial_state(config)
        config_dict = config.model_dump(mode="json")
        # Only the board, without condition metadata, defines matched starting tasks.
        first = next(iter(state["departments"].values()))
        initial_hash = first.get("initial_hash") or digest(first["tasks"])
        with self.lock, self.db:
            self.db.execute("INSERT INTO runs(id,config_json,config_hash,initial_state_hash,created_at,state_json) VALUES(?,?,?,?,?,?)",
                            (run_id, encode(config_dict), digest(config_dict), initial_hash, now(), encode(state)))
            self.db.execute("INSERT INTO snapshots VALUES(?,?,?,?)", (run_id, 0, encode(state), digest(state)))
        self.append(run_id, [{"event_type": "run_created", "payload_json": {
            "config_hash": digest(config_dict), "initial_state_hash": initial_hash,
            "mode": "MOCK / DEMONSTRATION" if config.provider == "mock" else "LIVE MODEL RUN"}}])
        return self.get(run_id)

    def get(self, run_id):
        with self.lock:
            row = self.db.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
        if not row:
            raise KeyError(run_id)
        result = dict(row)
        result["config"] = json.loads(result.pop("config_json"))
        result["state"] = json.loads(result.pop("state_json"))
        result["status"] = result["state"]["status"]
        return result

    def list(self):
        with self.lock:
            ids = [r[0] for r in self.db.execute("SELECT id FROM runs ORDER BY created_at DESC")]
        return [self.get(i) for i in ids]

    def runtime(self, run_id, **values):
        allowed = {"next_due", "retry_at", "control", "stop_day", "lease_owner", "lease_until"}
        if not values or not set(values) <= allowed:
            raise ValueError("invalid runtime fields")
        with self.lock, self.db:
            self.db.execute("UPDATE runs SET " + ",".join(f"{k}=?" for k in values) + " WHERE id=?", (*values.values(), run_id))

    def append(self, run_id, drafts, *, cursor=None):
        if cursor is not None:
            drafts = [*drafts, {"event_type": "cursor_advanced", "payload_json": {"cursor": cursor}}]
        committed = []
        with self.lock, self.db:
            row = self.db.execute("SELECT state_json,seq,config_json FROM runs WHERE id=?", (run_id,)).fetchone()
            if not row:
                raise KeyError(run_id)
            state, seq, config = json.loads(row[0]), row[1], json.loads(row[2])
            for draft in drafts:
                seq += 1
                dept = draft.get("department_id")
                event = {
                    "event_id": uuid.uuid4().hex, "run_id": run_id, "seq": seq,
                    "department_id": dept, "condition": dept,
                    "virtual_day": draft.get("virtual_day", state.get("virtual_day", 1)),
                    "ts_utc": now(), "agent_id": None, "event_type": "event",
                    "channel": None, "task_id": None, "payload_json": {},
                    "provider_model": "mock-v1" if config["provider"] == "mock" else config["model"],
                    "prompt_hash": None, "input_tokens": None, "output_tokens": None,
                    "estimated_cost_usd": None, "elapsed_ms": None, "severity": "info",
                }
                event.update(copy.deepcopy(draft))
                state = reduce_event(state, event)
                event["state_hash"] = digest(state)
                self.db.execute("INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?)", (
                    event["event_id"], run_id, seq, dept, event["virtual_day"], event["agent_id"],
                    event["channel"], event["task_id"], event["event_type"], event["severity"], encode(event)))
                if event["event_type"] == "message_sent":
                    p = event["payload_json"]
                    self.db.execute("INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?,?,?)", (
                        event["event_id"], run_id, seq, dept, event["virtual_day"], event["agent_id"],
                        event["channel"], event["task_id"], p.get("text", ""), p.get("visibility", "department"), p.get("recipient_id")))
                committed.append(event)
            self.db.execute("UPDATE runs SET state_json=?,seq=? WHERE id=?", (encode(state), seq, run_id))
            if drafts and (seq // 40 != row[1] // 40 or state["status"] in {"completed", "stopped"}):
                self.db.execute("INSERT OR IGNORE INTO snapshots VALUES(?,?,?,?)", (run_id, seq, encode(state), digest(state)))
        return committed

    def events(self, run_id, *, after=0, limit=None, **filters):
        clauses, args = ["run_id=?", "seq>?"], [run_id, after]
        columns = {"department_id", "agent_id", "channel", "task_id", "event_type", "severity", "virtual_day"}
        search = filters.pop("q", None)
        for key, value in filters.items():
            if key in columns and value not in (None, ""):
                clauses.append(f"{key}=?")
                args.append(value)
        if search:
            clauses.append("envelope_json LIKE ?")
            args.append("%" + search + "%")
        with self.lock:
            query = "SELECT envelope_json FROM events WHERE " + " AND ".join(clauses) + " ORDER BY seq"
            if limit is not None:
                query += " LIMIT ?"
                args.append(limit)
            rows = self.db.execute(query, args).fetchall()
        return [json.loads(r[0]) for r in rows]

    def replay(self, run_id, seq=None):
        run = self.get(run_id)
        target = run["seq"] if seq is None else max(0, min(seq, run["seq"]))
        with self.lock:
            row = self.db.execute("SELECT seq,state_json FROM snapshots WHERE run_id=? AND seq<=? ORDER BY seq DESC LIMIT 1", (run_id, target)).fetchone()
        state = json.loads(row[1])
        for event in self.events(run_id, after=row[0]):
            if event["seq"] > target:
                break
            state = reduce_event(state, event)
        return {"state": state, "seq": target, "state_hash": digest(state), "read_only": True}

    def claim_day(self, run_id, day):
        with self.lock, self.db:
            result = self.db.execute("INSERT OR IGNORE INTO day_jobs VALUES(?,?,?)", (run_id, day, now()))
            return result.rowcount == 1

    def acquire_lease(self, run_id, owner, until):
        with self.lock, self.db:
            result = self.db.execute("UPDATE runs SET lease_owner=?,lease_until=? WHERE id=? AND (lease_owner IS NULL OR lease_owner=? OR lease_until<?)", (owner, until, run_id, owner, now()))
            return result.rowcount == 1

    def close(self):
        self.db.close()
        if self.process_lock:
            self.process_lock.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.process_lock.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.process_lock, fcntl.LOCK_UN)
            self.process_lock.close()
