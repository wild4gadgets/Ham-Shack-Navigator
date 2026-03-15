import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import event

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:////data/shack_weather.db")

engine = create_async_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    echo=False,
)

# Enable WAL mode for better concurrent read performance
@event.listens_for(engine.sync_engine, "connect")
def set_wal_mode(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def init_db():
    """Create all tables."""
    async with engine.begin() as conn:
        from models import Base as ModelsBase  # noqa: F401
        await conn.run_sync(ModelsBase.metadata.create_all)
    await _migrate_db()


async def _migrate_db():
    """Run incremental schema migrations."""
    async with engine.begin() as conn:
        await conn.run_sync(_migrate_shutdown_steps_nullable_port)
        await conn.run_sync(_migrate_shutdown_steps_add_description)
        await conn.run_sync(_migrate_add_workflows)
        await conn.run_sync(_migrate_add_shelly)
        await conn.run_sync(_migrate_workflow_steps_add_shelly)


def _migrate_add_workflows(conn):
    """Create workflows/workflow_steps tables and seed/migrate from shutdown_steps."""
    sa = __import__("sqlalchemy")

    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS workflows (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name VARCHAR NOT NULL UNIQUE,
            is_system BOOLEAN NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """))
    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS workflow_steps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workflow_id INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
            step_order INTEGER NOT NULL,
            kasa_port_id INTEGER REFERENCES kasa_ports(id),
            action VARCHAR NOT NULL,
            delay_after_sec INTEGER NOT NULL DEFAULT 0,
            description VARCHAR,
            UNIQUE (workflow_id, step_order)
        )
    """))

    existing = conn.execute(sa.text(
        "SELECT id FROM workflows WHERE is_system = 1"
    )).fetchone()
    if not existing:
        conn.execute(sa.text(
            "INSERT INTO workflows (name, is_system, created_at) VALUES ('Shutdown', 1, datetime('now'))"
        ))
        existing = conn.execute(sa.text(
            "SELECT id FROM workflows WHERE is_system = 1"
        )).fetchone()

    workflow_id = existing[0]

    count = conn.execute(sa.text(
        "SELECT COUNT(*) FROM workflow_steps WHERE workflow_id = :wid"
    ), {"wid": workflow_id}).fetchone()[0]

    if count == 0:
        tbl = conn.execute(sa.text(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='shutdown_steps'"
        )).fetchone()
        if tbl:
            old = conn.execute(sa.text(
                "SELECT step_order, kasa_port_id, action, delay_after_sec, description FROM shutdown_steps ORDER BY step_order"
            )).fetchall()
            for row in old:
                conn.execute(sa.text("""
                    INSERT INTO workflow_steps (workflow_id, step_order, kasa_port_id, action, delay_after_sec, description)
                    VALUES (:wid, :ord, :port, :action, :delay, :desc)
                """), {
                    "wid": workflow_id,
                    "ord": row[0],
                    "port": row[1],
                    "action": row[2],
                    "delay": row[3],
                    "desc": row[4],
                })


def _migrate_add_shelly(conn):
    """Create shelly_devices and shelly_channels tables."""
    sa = __import__("sqlalchemy")
    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS shelly_devices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name VARCHAR NOT NULL,
            ip_address VARCHAR NOT NULL,
            channel_count INTEGER NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """))
    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS shelly_channels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id INTEGER NOT NULL REFERENCES shelly_devices(id) ON DELETE CASCADE,
            channel_index INTEGER NOT NULL,
            label VARCHAR,
            UNIQUE (device_id, channel_index)
        )
    """))


def _migrate_workflow_steps_add_shelly(conn):
    """Add shelly_channel_id column to workflow_steps if missing."""
    info = conn.execute(
        __import__("sqlalchemy").text("PRAGMA table_info(workflow_steps)")
    ).fetchall()
    cols = {col[1] for col in info}
    if "shelly_channel_id" not in cols:
        conn.execute(__import__("sqlalchemy").text(
            "ALTER TABLE workflow_steps ADD COLUMN shelly_channel_id INTEGER REFERENCES shelly_channels(id)"
        ))


def _migrate_shutdown_steps_add_description(conn):
    """Add description column to shutdown_steps if missing."""
    info = conn.execute(
        __import__("sqlalchemy").text("PRAGMA table_info(shutdown_steps)")
    ).fetchall()
    cols = {col[1] for col in info}
    if "description" not in cols:
        conn.execute(__import__("sqlalchemy").text(
            "ALTER TABLE shutdown_steps ADD COLUMN description VARCHAR"
        ))


def _migrate_shutdown_steps_nullable_port(conn):
    """Rebuild shutdown_steps if kasa_port_id is still NOT NULL (pre-pause-step schema)."""
    info = conn.execute(
        __import__("sqlalchemy").text("PRAGMA table_info(shutdown_steps)")
    ).fetchall()
    for col in info:
        # col: (cid, name, type, notnull, dflt_value, pk)
        if col[1] == "kasa_port_id" and col[3] == 1:  # notnull == 1
            conn.execute(__import__("sqlalchemy").text("""
                CREATE TABLE shutdown_steps_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    step_order INTEGER NOT NULL UNIQUE,
                    kasa_port_id INTEGER REFERENCES kasa_ports(id),
                    action VARCHAR NOT NULL,
                    delay_after_sec INTEGER DEFAULT 0
                )
            """))
            conn.execute(__import__("sqlalchemy").text(
                "INSERT INTO shutdown_steps_new SELECT * FROM shutdown_steps"
            ))
            conn.execute(__import__("sqlalchemy").text("DROP TABLE shutdown_steps"))
            conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE shutdown_steps_new RENAME TO shutdown_steps"
            ))
            break
