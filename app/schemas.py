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


class ChangeEmailRequest(BaseModel):
    current_password: str
    new_email: str


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
    units: str = "imperial"  # "imperial" or "metric"
    gridsquare: str = ""
    active_profile_id: str = ""


class LocationProfile(BaseModel):
    id: str = ""
    name: str = "Default"
    lat: float = 0.0
    lon: float = 0.0
    city: str = ""
    units: str = "imperial"
    gridsquare: str = ""


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
    shutdown_ifttt: bool = True
    threshold_ifttt: bool = True
    shutdown_telegram: bool = True
    threshold_telegram: bool = True


class IftttSettings(BaseModel):
    webhook_key: Optional[str] = None
    event_name_shutdown: str = "ham_shack_shutdown"
    event_name_threshold: str = "ham_shack_alert"
    enabled: bool = False
    incoming_secret: Optional[str] = None


class TelegramSettings(BaseModel):
    bot_token: Optional[str] = None
    chat_id: Optional[str] = None
    enabled: bool = False


class HomeAssistantSettings(BaseModel):
    ha_url: str = ""
    ha_token: Optional[str] = None
    enabled_push: bool = False
    enabled_pull: bool = True
    ha_poll_token: Optional[str] = None


class KasaSettings(BaseModel):
    poll_interval_sec: int = 30


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

    @field_validator("label")
    @classmethod
    def label_max_length(cls, v):
        if v is not None and len(v) > 15:
            raise ValueError("Port label must be 15 characters or fewer")
        return v


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
    kasa_port_id: int | None = None
    action: str  # "on", "off", or "pause"
    delay_after_sec: int = 0
    description: Optional[str] = None


class ShutdownSequenceRequest(BaseModel):
    steps: list[ShutdownStepRequest]


class ShutdownStepResponse(BaseModel):
    id: int
    step_order: int
    kasa_port_id: int | None
    action: str
    delay_after_sec: int
    description: Optional[str] = None

    class Config:
        from_attributes = True


# --- Workflows ---
class WorkflowCreate(BaseModel):
    name: str


class WorkflowResponse(BaseModel):
    id: int
    name: str
    is_system: bool

    class Config:
        from_attributes = True


class WorkflowStepRequest(BaseModel):
    kasa_port_id: int | None = None
    action: str
    delay_after_sec: int = 0
    description: Optional[str] = None


class WorkflowStepsRequest(BaseModel):
    steps: list[WorkflowStepRequest]


class WorkflowStepResponse(BaseModel):
    id: int
    workflow_id: int
    step_order: int
    kasa_port_id: int | None
    action: str
    delay_after_sec: int
    description: Optional[str] = None

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
