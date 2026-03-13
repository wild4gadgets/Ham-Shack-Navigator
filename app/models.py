from datetime import datetime
from sqlalchemy import (
    Integer, String, Text, DateTime, Boolean, ForeignKey, UniqueConstraint, Index
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    hashed_pw: Mapped[str] = mapped_column(String, nullable=False)
    is_active: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class KasaDevice(Base):
    __tablename__ = "kasa_devices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    device_type: Mapped[str] = mapped_column(String, nullable=False)  # "strip" or "plug"
    ip_address: Mapped[str] = mapped_column(String, nullable=False)
    port_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    ports: Mapped[list["KasaPort"]] = relationship(
        "KasaPort", back_populates="device", cascade="all, delete-orphan"
    )


class KasaPort(Base):
    __tablename__ = "kasa_ports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    device_id: Mapped[int] = mapped_column(Integer, ForeignKey("kasa_devices.id", ondelete="CASCADE"), nullable=False)
    port_index: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[str | None] = mapped_column(String, nullable=True)

    device: Mapped["KasaDevice"] = relationship("KasaDevice", back_populates="ports")
    shutdown_steps: Mapped[list["ShutdownStep"]] = relationship("ShutdownStep", back_populates="kasa_port")

    __table_args__ = (UniqueConstraint("device_id", "port_index"),)


class ShutdownStep(Base):
    __tablename__ = "shutdown_steps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    step_order: Mapped[int] = mapped_column(Integer, nullable=False, unique=True)
    kasa_port_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("kasa_ports.id"), nullable=True)
    action: Mapped[str] = mapped_column(String, nullable=False)  # "on", "off", or "pause"
    delay_after_sec: Mapped[int] = mapped_column(Integer, default=0)
    description: Mapped[str | None] = mapped_column(String, nullable=True)

    kasa_port: Mapped["KasaPort | None"] = relationship("KasaPort", back_populates="shutdown_steps")


class Workflow(Base):
    __tablename__ = "workflows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    steps: Mapped[list["WorkflowStep"]] = relationship(
        "WorkflowStep", back_populates="workflow", cascade="all, delete-orphan"
    )


class WorkflowStep(Base):
    __tablename__ = "workflow_steps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workflow_id: Mapped[int] = mapped_column(Integer, ForeignKey("workflows.id", ondelete="CASCADE"), nullable=False)
    step_order: Mapped[int] = mapped_column(Integer, nullable=False)
    kasa_port_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("kasa_ports.id"), nullable=True)
    action: Mapped[str] = mapped_column(String, nullable=False)
    delay_after_sec: Mapped[int] = mapped_column(Integer, default=0)
    description: Mapped[str | None] = mapped_column(String, nullable=True)

    workflow: Mapped["Workflow"] = relationship("Workflow", back_populates="steps")
    kasa_port: Mapped["KasaPort | None"] = relationship("KasaPort")

    __table_args__ = (UniqueConstraint("workflow_id", "step_order"),)


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_type: Mapped[str] = mapped_column(String, nullable=False)
    severity: Mapped[str] = mapped_column(String, nullable=False)  # info, warning, critical
    message: Mapped[str] = mapped_column(Text, nullable=False)
    meta: Mapped[str | None] = mapped_column("metadata", Text, nullable=True)  # JSON
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (Index("ix_events_created_at", "created_at"),)


class WeatherCache(Base):
    __tablename__ = "weather_cache"

    source: Mapped[str] = mapped_column(String, primary_key=True)  # owm_current, owm_forecast, tomorrow_realtime
    data: Mapped[str] = mapped_column(Text, nullable=False)  # raw API JSON
    fetched_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
