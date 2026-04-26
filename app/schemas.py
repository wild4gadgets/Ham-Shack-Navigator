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
    role: str
    is_active: int

    class Config:
        from_attributes = True


class AdminUserResponse(BaseModel):
    id: int
    email: str
    role: str
    is_active: int
    created_at: str

    class Config:
        from_attributes = True

    @classmethod
    def from_orm_user(cls, u):
        return cls(
            id=u.id,
            email=u.email,
            role=u.role,
            is_active=u.is_active,
            created_at=u.created_at.isoformat() if u.created_at else "",
        )


class CreateUserRequest(BaseModel):
    email: str
    password: str
    role: str = "readonly"

    @field_validator("password")
    @classmethod
    def password_complexity(cls, v):
        return validate_password_complexity(v)

    @field_validator("role")
    @classmethod
    def valid_role(cls, v):
        if v not in ("admin", "readonly"):
            raise ValueError("Role must be 'admin' or 'readonly'")
        return v


class UpdateUserRoleRequest(BaseModel):
    role: str

    @field_validator("role")
    @classmethod
    def valid_role(cls, v):
        if v not in ("admin", "readonly"):
            raise ValueError("Role must be 'admin' or 'readonly'")
        return v


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
    callsign: str = ""
    units: str = "imperial"  # "imperial" or "metric"
    gridsquare: str = ""
    active_profile_id: str = ""


class LocationProfile(BaseModel):
    id: str = ""
    name: str = "Default"
    lat: float = 0.0
    lon: float = 0.0
    city: str = ""
    callsign: str = ""
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


class DxclusterSettings(BaseModel):
    region: str = "NA"
    refresh_interval_sec: int = 300


class QrzSettings(BaseModel):
    username: str = ""
    password: str = ""


class PskReporterSettings(BaseModel):
    callsign: str = ""
    default_direction: str = "senderCallsign"
    default_modes: list[str] = []
    default_bands: list[str] = []
    default_timespan: int = -3600


class FlexRadioSettings(BaseModel):
    ip: str = ""
    enabled: bool = False
    dax_enabled: bool = True
    dax_channel: int = 1
    cw_tone_freq: float = 700.0
    cw_threshold: float = 0.15
    freq_step_small_khz: float = 50.0
    freq_step_large_khz: float = 100.0
    tx_button_label: str = "MOX"

    @field_validator("tx_button_label")
    @classmethod
    def label_uppercase_max4(cls, v):
        v = v.strip().upper()
        if not v:
            return "MOX"
        return v[:4]


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

    show_on_dashboard: Optional[bool] = None


class KasaPortControl(BaseModel):
    action: str  # "on" or "off"


class KasaPortResponse(BaseModel):
    id: int
    device_id: int
    port_index: int
    label: Optional[str]
    show_on_dashboard: bool = False

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
    shelly_channel_id: int | None = None
    action: str
    delay_after_sec: int = 0
    description: Optional[str] = None
    ifttt_event_name: Optional[str] = None
    ifttt_value1: Optional[str] = None
    ifttt_value2: Optional[str] = None
    ifttt_value3: Optional[str] = None


class WorkflowStepsRequest(BaseModel):
    steps: list[WorkflowStepRequest]


class WorkflowStepResponse(BaseModel):
    id: int
    workflow_id: int
    step_order: int
    kasa_port_id: int | None
    shelly_channel_id: int | None
    action: str
    delay_after_sec: int
    description: Optional[str] = None
    ifttt_event_name: Optional[str] = None
    ifttt_value1: Optional[str] = None
    ifttt_value2: Optional[str] = None
    ifttt_value3: Optional[str] = None

    class Config:
        from_attributes = True


class ScheduledWorkflowCreate(BaseModel):
    workflow_id: int
    run_time: str  # "HH:MM" UTC
    days_of_week: list[int]  # [0-6] where 0=Sun
    enabled: bool = True


class ScheduledWorkflowUpdate(BaseModel):
    workflow_id: Optional[int] = None
    run_time: Optional[str] = None
    days_of_week: Optional[list[int]] = None
    enabled: Optional[bool] = None


class ScheduledWorkflowResponse(BaseModel):
    id: int
    workflow_id: int
    workflow_name: str
    enabled: bool
    run_time: str
    days_of_week: list[int]

    class Config:
        from_attributes = True

    @field_validator("days_of_week", mode="before")
    @classmethod
    def parse_days(cls, v):
        if isinstance(v, str):
            return [int(d) for d in v.split(",") if d.strip()]
        return v


# --- Shelly ---
class ShellyDeviceCreate(BaseModel):
    name: str
    ip_address: str
    channel_count: int = 1
    generation: int = 1


class ShellyDeviceUpdate(BaseModel):
    name: Optional[str] = None
    ip_address: Optional[str] = None
    generation: Optional[int] = None


class ShellyChannelUpdate(BaseModel):
    label: Optional[str] = None
    show_on_dashboard: Optional[bool] = None


class ShellyChannelResponse(BaseModel):
    id: int
    device_id: int
    channel_index: int
    label: Optional[str]
    show_on_dashboard: bool = False

    class Config:
        from_attributes = True


class ShellyDeviceResponse(BaseModel):
    id: int
    name: str
    ip_address: str
    channel_count: int
    generation: int = 1
    channels: list[ShellyChannelResponse] = []

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
