import re
from typing import Optional
from pydantic import BaseModel, field_validator


def validate_password_complexity(v: str) -> str:
    if len(v) < 10:
        raise ValueError("Password must be at least 10 characters")
    if not re.search(r"[A-Z]", v):
        raise ValueError("Password must contain at least one uppercase letter")
    if not re.search(r"[a-z]", v):
        raise ValueError("Password must contain at least one lowercase letter")
    if not re.search(r"\d", v):
        raise ValueError("Password must contain at least one digit")
    if not re.search(r"[^A-Za-z0-9]", v):
        raise ValueError("Password must contain at least one special character")
    return v


# --- Auth ---
class SetupRequest(BaseModel):
    email: str
    password: str

    @field_validator("password")
    @classmethod
    def password_complexity(cls, v):
        return validate_password_complexity(v)


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: int
    email: str
    is_active: int

    class Config:
        from_attributes = True


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def password_complexity(cls, v):
        return validate_password_complexity(v)


# --- Settings ---
class LocationSettings(BaseModel):
    lat: float
    lon: float
    city: str = ""


class ApiKeySettings(BaseModel):
    owm_key: Optional[str] = None
    tomorrow_key: Optional[str] = None


class ThresholdSettings(BaseModel):
    wind_mph: float = 35.0
    lightning_miles: float = 10.0
    poll_interval_sec: int = 300
    cooldown_min: int = 30


class SmtpSettings(BaseModel):
    host: str = ""
    port: int = 587
    user: str = ""
    password: Optional[str] = None
    from_addr: str = ""
    to_addr: str = ""
    digest_time: str = "06:00"
    digest_enabled: bool = True


class NotificationSettings(BaseModel):
    shutdown_email: bool = True
    digest_email: bool = True


# --- Kasa ---
class KasaDeviceCreate(BaseModel):
    name: str
    device_type: str  # "strip" or "plug"
    ip_address: str
    port_count: Optional[int] = None


class KasaDeviceUpdate(BaseModel):
    name: Optional[str] = None
    ip_address: Optional[str] = None


class KasaPortUpdate(BaseModel):
    label: Optional[str] = None


class KasaPortControl(BaseModel):
    action: str  # "on" or "off"


class KasaPortResponse(BaseModel):
    id: int
    device_id: int
    port_index: int
    label: Optional[str]

    class Config:
        from_attributes = True


class KasaDeviceResponse(BaseModel):
    id: int
    name: str
    device_type: str
    ip_address: str
    port_count: Optional[int]
    ports: list[KasaPortResponse] = []

    class Config:
        from_attributes = True


# --- Shutdown ---
class ShutdownStepRequest(BaseModel):
    kasa_port_id: int
    action: str  # "on" or "off"
    delay_after_sec: int = 0


class ShutdownSequenceRequest(BaseModel):
    steps: list[ShutdownStepRequest]


class ShutdownStepResponse(BaseModel):
    id: int
    step_order: int
    kasa_port_id: int
    action: str
    delay_after_sec: int

    class Config:
        from_attributes = True


# --- Events ---
class EventResponse(BaseModel):
    id: int
    event_type: str
    severity: str
    message: str
    meta: Optional[str]
    created_at: str

    class Config:
        from_attributes = True


class EventsPage(BaseModel):
    items: list[EventResponse]
    total: int
    page: int
    page_size: int
    pages: int
