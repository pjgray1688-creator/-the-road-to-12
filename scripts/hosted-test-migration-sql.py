#!/usr/bin/env python3
"""Emit one repository migration for disposable hosted-Postgres contract tests.

The test harness supplies the migration path, ledger name, and a fixture checksum.
This helper only reads migrations inside this checkout and does not connect to a
hosted database or execute SQL.
"""
from pathlib import Path
import re
import sys


def main() -> int:
    if len(sys.argv) != 4:
        print("usage: hosted-test-migration-sql.py MIGRATION_PATH MIGRATION_NAME CHECKSUM", file=sys.stderr)
        return 2
    relative = Path(sys.argv[1])
    name = sys.argv[2]
    checksum = sys.argv[3]
    root = Path(__file__).resolve().parents[1]
    target = (root / relative).resolve()
    migration_root = (root / "supabase" / "migrations").resolve()
    if not target.is_relative_to(migration_root) or not target.is_file():
        print("migration must be an existing file under supabase/migrations", file=sys.stderr)
        return 2
    if name != relative.as_posix() or not re.fullmatch(r"[a-f0-9]{64}", checksum):
        print("migration identity or checksum format is invalid", file=sys.stderr)
        return 2
    sys.stdout.write(target.read_text())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
