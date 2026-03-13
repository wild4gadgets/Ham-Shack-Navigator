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
