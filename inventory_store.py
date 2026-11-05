import json
import math
import re
import sqlite3
from contextlib import closing
from datetime import date


class Conflict(Exception):
    pass


def valid_id(value):
    return type(value) is int and 0 < value <= 2**53 - 1


def validate(data):
    if not isinstance(data, dict):
        raise ValueError("물품대장 데이터가 필요합니다.")
    items, logs, agencies = data.get("items"), data.get("logs"), data.get("agencies", [])
    if not isinstance(items, list) or not isinstance(logs, dict) or not isinstance(agencies, list):
        raise ValueError("items, logs, agencies 형식이 올바르지 않습니다.")
    if any(not isinstance(name, str) for name in agencies):
        raise ValueError("기관명은 문자열이어야 합니다.")
    item_ids = set()
    for item in items:
        if (
            not isinstance(item, dict)
            or not valid_id(item.get("id"))
            or item["id"] in item_ids
            or not isinstance(item.get("name"), str)
            or type(item.get("isDeleted", False)) is not bool
        ):
            raise ValueError("물품 정보가 올바르지 않거나 물품 ID가 중복됩니다.")
        item_ids.add(item["id"])
    for day, entries in logs.items():
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
            raise ValueError("기록 날짜는 YYYY-MM-DD 형식이어야 합니다.")
        date.fromisoformat(day)
        if not isinstance(entries, list):
            raise ValueError("날짜별 기록은 배열이어야 합니다.")
        for entry in entries:
            if (
                not isinstance(entry, dict)
                or not valid_id(entry.get("id"))
                or not valid_id(entry.get("itemId"))
                or not isinstance(entry.get("org"), str)
                or type(entry.get("qty")) not in (int, float)
                or not 0 < entry["qty"] <= 2**53 - 1
                or not math.isfinite(entry["qty"])
            ):
                raise ValueError("날짜별 물품 기록이 올바르지 않습니다.")
    return items, logs, agencies


class InventoryStore:
    def __init__(self, path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with closing(self.connect()) as db:
            db.executescript("""
                BEGIN IMMEDIATE;
                CREATE TABLE IF NOT EXISTS inventory_revision (
                    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                    revision INTEGER NOT NULL
                );
                INSERT OR IGNORE INTO inventory_revision VALUES (1, 0);
                CREATE TABLE IF NOT EXISTS items (
                    id INTEGER PRIMARY KEY,
                    position INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    is_deleted INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS agencies (
                    position INTEGER PRIMARY KEY,
                    name TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS log_days (
                    day TEXT PRIMARY KEY
                );
                CREATE TABLE IF NOT EXISTS ledger_entries (
                    day TEXT NOT NULL REFERENCES log_days(day),
                    position INTEGER NOT NULL,
                    id INTEGER NOT NULL,
                    item_id INTEGER NOT NULL,
                    org TEXT NOT NULL,
                    qty NUMERIC NOT NULL,
                    PRIMARY KEY (day, position)
                );
                COMMIT;
            """)

    def connect(self):
        db = sqlite3.connect(self.path)
        db.execute("PRAGMA foreign_keys = ON")
        return db

    def snapshot(self):
        with closing(self.connect()) as db:
            return self.read_snapshot(db)

    @staticmethod
    def read_snapshot(db):
        with db:
            db.execute("BEGIN")
            revision = db.execute("SELECT revision FROM inventory_revision").fetchone()[0]
            items = [
                {"id": item_id, "name": name, "isDeleted": bool(deleted)}
                for item_id, name, deleted in db.execute(
                    "SELECT id, name, is_deleted FROM items ORDER BY position"
                )
            ]
            agencies = [name for (name,) in db.execute("SELECT name FROM agencies ORDER BY position")]
            logs = {day: [] for (day,) in db.execute("SELECT day FROM log_days ORDER BY day")}
            for day, entry_id, item_id, org, qty in db.execute(
                "SELECT day, id, item_id, org, qty FROM ledger_entries ORDER BY day, position"
            ):
                logs[day].append({"id": entry_id, "itemId": item_id, "org": org, "qty": qty})
            return {"revision": revision, "data": {"items": items, "logs": logs, "agencies": agencies}}

    def backup(self, path):
        with closing(self.connect()) as source, closing(sqlite3.connect(path)) as target:
            source.backup(target)

    def restore(self, revision, path):
        try:
            with closing(sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)) as source:
                source.execute("PRAGMA trusted_schema = OFF")
                tables = {name for (name,) in source.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'"
                )}
                expected = {"inventory_revision", "items", "agencies", "log_days", "ledger_entries"}
                if not expected.issubset(tables) or source.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
                    raise ValueError("물품대장 SQLite 파일을 확인하세요.")
                if source.execute("PRAGMA foreign_key_check").fetchone():
                    raise ValueError("SQLite 기록의 참조가 올바르지 않습니다.")
                snapshot = self.read_snapshot(source)
        except (sqlite3.Error, KeyError, TypeError) as error:
            raise ValueError("물품대장 SQLite 파일을 읽을 수 없습니다.") from error
        return self.replace(revision, snapshot["data"])

    def replace(self, revision, data):
        if type(revision) is not int or revision < 0:
            raise ValueError("유효한 revision이 필요합니다.")
        items, logs, agencies = validate(data)
        with closing(self.connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            updated = db.execute(
                "UPDATE inventory_revision SET revision = revision + 1 WHERE revision = ?", (revision,)
            )
            if updated.rowcount != 1:
                raise Conflict
            db.execute("DELETE FROM ledger_entries")
            db.execute("DELETE FROM log_days")
            db.execute("DELETE FROM items")
            db.execute("DELETE FROM agencies")
            db.executemany(
                "INSERT INTO items VALUES (?, ?, ?, ?)",
                ((item["id"], pos, item["name"], item.get("isDeleted", False))
                 for pos, item in enumerate(items)),
            )
            db.executemany("INSERT INTO agencies VALUES (?, ?)", enumerate(agencies))
            db.executemany("INSERT INTO log_days VALUES (?)", ((day,) for day in logs))
            db.executemany(
                "INSERT INTO ledger_entries VALUES (?, ?, ?, ?, ?, ?)",
                ((day, pos, entry["id"], entry["itemId"], entry["org"], entry["qty"])
                 for day, entries in logs.items() for pos, entry in enumerate(entries)),
            )
        return revision + 1

    def import_json(self, path):
        with path.open(encoding="utf-8-sig") as source:
            self.replace(0, json.load(source))
