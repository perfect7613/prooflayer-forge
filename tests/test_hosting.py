import sqlite3
from runtime import hosting


def test_snapshot_includes_committed_wal_and_restores(tmp_path, monkeypatch):
    live = tmp_path / 'local' / 'db.sqlite'
    saved = tmp_path / 'volume' / 'trueforge.sqlite'
    live.parent.mkdir()
    saved.parent.mkdir()
    monkeypatch.setattr(hosting, 'LIVE_DB', live)
    monkeypatch.setattr(hosting, 'SAVED_DB', saved)
    with sqlite3.connect(live) as db:
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('CREATE TABLE checkpoints (value TEXT)')
        db.execute('INSERT INTO checkpoints VALUES (?)', ('pending human approval',))
        db.commit()
        hosting.snapshot_database()
        with sqlite3.connect(saved) as snapshot:
            assert snapshot.execute('SELECT value FROM checkpoints').fetchone()[0] == 'pending human approval'
    live.unlink()
    hosting.restore_database()
    with sqlite3.connect(live) as restored:
        assert restored.execute('SELECT count(*) FROM checkpoints').fetchone()[0] == 1
