from typing import Any

import aiohttp
from fastapi import APIRouter, Depends, Query

from dependencies import get_current_user
from models import User

router = APIRouter(prefix="/dxcluster", tags=["dxcluster"])

# DXWatch public API — returns the most recent N spots as a JSON dict
DXWATCH_URL = "http://www.dxwatch.com/dxsd1/s.php"

FREQ_BANDS = [
    (1800,   2000,   "160m"),
    (3500,   4000,   "80m"),
    (5330,   5406,   "60m"),
    (7000,   7300,   "40m"),
    (10100,  10150,  "30m"),
    (14000,  14350,  "20m"),
    (18068,  18168,  "17m"),
    (21000,  21450,  "15m"),
    (24890,  24990,  "12m"),
    (28000,  29700,  "10m"),
    (50000,  54000,  "6m"),
    (144000, 148000, "2m"),
]

BANDS = ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "2m"]
CONTINENTS = ["AF", "AS", "EU", "NA", "OC", "SA"]

# ── Callsign prefix → continent lookup ──────────────────────────────────────
# Covers all major DXCC entities. Unknown prefixes are silently skipped.
_PREFIX_CONT: dict[str, str] = {
    # ── North America ──────────────────────────────────────────────────────
    "AA": "NA", "AB": "NA", "AC": "NA", "AD": "NA", "AE": "NA",
    "AF": "NA", "AG": "NA", "AH": "NA", "AI": "NA", "AJ": "NA",
    "AK": "NA", "AL": "NA",
    "K": "NA", "N": "NA", "W": "NA",
    # Canada
    "VA": "NA", "VB": "NA", "VC": "NA", "VD": "NA", "VE": "NA",
    "VF": "NA", "VG": "NA", "VO": "NA", "VX": "NA", "VY": "NA",
    "CF": "NA", "CG": "NA", "CH": "NA", "CI": "NA", "CJ": "NA", "CK": "NA",
    "CY": "NA", "CZ": "NA",
    "XJ": "NA", "XK": "NA", "XL": "NA", "XM": "NA", "XN": "NA", "XO": "NA",
    # Mexico
    "XA": "NA", "XB": "NA", "XC": "NA", "XD": "NA", "XE": "NA",
    "XF": "NA", "XG": "NA", "XH": "NA", "XI": "NA",
    "4A": "NA", "4B": "NA", "4C": "NA",
    # Cuba
    "CL": "NA", "CM": "NA", "CO": "NA", "T4": "NA",
    # Haiti / Dominican Republic
    "HH": "NA", "4V": "NA", "HI": "NA",
    # Panama, C. America
    "HO": "NA", "HP": "NA", "TI": "NA",
    "YN": "NA", "HT": "NA", "HU": "NA",
    "HQ": "NA", "HR": "NA",
    "TG": "NA", "V3": "NA",
    # Caribbean
    "VP9": "NA",                       # Bermuda
    "ZF":  "NA",                       # Cayman
    "V4":  "NA", "V2": "NA",          # St. Kitts, Antigua
    "J3":  "NA", "J6": "NA",          # Grenada, St. Lucia
    "J7":  "NA", "J8": "NA",          # Dominica, St. Vincent
    "FM":  "NA", "FG": "NA",          # Martinique, Guadeloupe
    "P4":  "NA",                       # Aruba
    "6Y":  "NA",                       # Jamaica
    "C6":  "NA",                       # Bahamas
    "8P":  "NA",                       # Barbados
    "9Y":  "NA", "9Z": "NA",          # Trinidad & Tobago
    "VP5": "NA",                       # Turks & Caicos
    "FJ":  "NA",                       # St. Barthelemy
    # US territories (Pacific treated below as OC)
    "KP4": "NA", "WP4": "NA",         # Puerto Rico
    "KP2": "NA", "WP2": "NA",         # US Virgin Islands

    # ── South America ──────────────────────────────────────────────────────
    # Brazil
    "PP": "SA", "PQ": "SA", "PR": "SA", "PS": "SA", "PT": "SA",
    "PU": "SA", "PV": "SA", "PW": "SA", "PX": "SA", "PY": "SA",
    "ZV": "SA", "ZW": "SA", "ZX": "SA", "ZY": "SA", "ZZ": "SA",
    # Argentina
    "LO": "SA", "LP": "SA", "LQ": "SA", "LR": "SA", "LS": "SA",
    "LT": "SA", "LU": "SA", "LV": "SA", "LW": "SA",
    "AY": "SA", "AZ": "SA",
    # Chile
    "CA": "SA", "CB": "SA", "CC": "SA", "CD": "SA", "CE": "SA",
    "XQ": "SA", "XR": "SA",
    # Uruguay
    "CV": "SA", "CW": "SA", "CX": "SA",
    # Paraguay
    "ZP": "SA",
    # Bolivia
    "CP": "SA",
    # Peru
    "OA": "SA", "OB": "SA", "OC": "SA",
    # Ecuador
    "HC": "SA", "HD": "SA",
    # Colombia
    "HJ": "SA", "HK": "SA",
    # Venezuela
    "YV": "SA", "YW": "SA", "YX": "SA", "YY": "SA", "4M": "SA",
    # Guyana, Suriname, French Guiana
    "8R": "SA", "PZ": "SA", "FY": "SA",

    # ── Europe ─────────────────────────────────────────────────────────────
    # Germany
    "DA": "EU", "DB": "EU", "DC": "EU", "DD": "EU", "DE": "EU",
    "DF": "EU", "DG": "EU", "DH": "EU", "DI": "EU", "DJ": "EU",
    "DK": "EU", "DL": "EU", "DM": "EU", "DN": "EU", "DO": "EU",
    "DP": "EU", "DQ": "EU", "DR": "EU",
    # UK (England, Scotland, Wales, N.Ireland, islands)
    "G":  "EU", "M":  "EU",
    "GD": "EU", "GI": "EU", "GJ": "EU", "GM": "EU", "GU": "EU", "GW": "EU",
    "2E": "EU", "2I": "EU", "2J": "EU", "2M": "EU", "2U": "EU", "2W": "EU",
    # France (including TM, TH special prefixes)
    "F":  "EU", "TH": "EU", "TM": "EU", "TV": "EU",
    # Italy
    "I":  "EU",
    # Spain
    "EA": "EU", "EB": "EU", "EC": "EU", "ED": "EU", "EE": "EU",
    "EF": "EU", "EG": "EU", "EH": "EU",
    "AM": "EU", "AN": "EU", "AO": "EU",
    # Portugal
    "CT": "EU", "CS": "EU",
    # Azores, Madeira (geographically AF but politically EU)
    "CQ": "EU", "CR": "EU", "CU": "EU",
    # Netherlands
    "PA": "EU", "PB": "EU", "PC": "EU", "PD": "EU", "PE": "EU",
    "PF": "EU", "PG": "EU", "PH": "EU", "PI": "EU",
    # Belgium
    "ON": "EU", "OO": "EU", "OP": "EU", "OQ": "EU", "OR": "EU",
    "OS": "EU", "OT": "EU",
    # Denmark
    "OU": "EU", "OV": "EU", "OW": "EU", "OX": "EU", "OY": "EU", "OZ": "EU",
    # Sweden
    "SA": "EU", "SB": "EU", "SC": "EU", "SD": "EU", "SE": "EU",
    "SF": "EU", "SG": "EU", "SH": "EU", "SI": "EU", "SJ": "EU",
    "SK": "EU", "SL": "EU", "SM": "EU",
    # Norway
    "LA": "EU", "LB": "EU", "LC": "EU", "LD": "EU", "LE": "EU",
    "LF": "EU", "LG": "EU", "LH": "EU", "LI": "EU", "LJ": "EU",
    "LK": "EU", "LL": "EU", "LM": "EU", "LN": "EU",
    # Finland + Åland + Market Reef
    "OF": "EU", "OG": "EU", "OH": "EU", "OI": "EU", "OJ": "EU",
    # Switzerland
    "HB": "EU", "HE": "EU",
    # Austria
    "OE": "EU",
    # Liechtenstein, Monaco, Andorra, San Marino, Vatican
    "HB0": "EU", "3A": "EU", "C3": "EU", "T7": "EU", "HV": "EU",
    # Luxembourg
    "LX": "EU",
    # Poland
    "SP": "EU", "SQ": "EU", "SR": "EU", "3Z": "EU", "HF": "EU",
    # Czech Republic
    "OK": "EU", "OL": "EU",
    # Slovakia
    "OM": "EU",
    # Hungary
    "HA": "EU", "HG": "EU",
    # Romania
    "YO": "EU", "YP": "EU", "YQ": "EU", "YR": "EU",
    # Bulgaria
    "LZ": "EU",
    # Serbia
    "YT": "EU", "YU": "EU",
    # Croatia
    "9A": "EU",
    # Slovenia
    "S5": "EU",
    # Bosnia
    "E7": "EU", "T9": "EU",
    # Montenegro
    "4O": "EU",
    # North Macedonia
    "Z3": "EU",
    # Albania
    "ZA": "EU",
    # Greece
    "SV": "EU", "SW": "EU", "J4": "EU",
    # Cyprus
    "5B": "EU", "P3": "EU",
    # Russia (European districts 1–6; 0, 7–9 are AS — approximated as EU)
    "R":  "EU", "U":  "EU",
    "UA": "EU", "UB": "EU", "UC": "EU", "UD": "EU", "UE": "EU",
    "UF": "EU", "UG": "EU",
    # Ukraine
    "UR": "EU", "US": "EU", "UT": "EU", "UU": "EU", "UV": "EU",
    "UW": "EU", "UX": "EU", "UY": "EU", "UZ": "EU",
    "EM": "EU", "EN": "EU", "EO": "EU",
    # Belarus
    "EU": "EU", "EV": "EU", "EW": "EU",
    # Moldova
    "ER": "EU",
    # Lithuania / Latvia / Estonia
    "LY": "EU", "YL": "EU", "ES": "EU",
    # Iceland
    "TF": "EU",
    # Svalbard / Jan Mayen
    "JW": "EU", "JX": "EU",
    # Malta
    "9H": "EU",
    # Kosovo
    "Z6": "EU",

    # ── Asia ───────────────────────────────────────────────────────────────
    # Japan
    "JA": "AS", "JB": "AS", "JC": "AS", "JD": "AS", "JE": "AS",
    "JF": "AS", "JG": "AS", "JH": "AS", "JI": "AS", "JJ": "AS",
    "JK": "AS", "JL": "AS", "JM": "AS", "JN": "AS", "JO": "AS",
    "JP": "AS", "JQ": "AS", "JR": "AS", "JS": "AS",
    "7J": "AS", "7K": "AS", "7L": "AS", "7M": "AS", "7N": "AS",
    # China
    "B":  "AS", "BY": "AS", "BG": "AS", "BA": "AS", "BD": "AS",
    "BH": "AS", "BI": "AS", "BJ": "AS", "BL": "AS",
    "VR": "AS",   # Hong Kong
    "XX": "AS",   # Macau
    # South Korea
    "HL": "AS", "DS": "AS", "DT": "AS",
    "6K": "AS", "6L": "AS", "6M": "AS", "6N": "AS",
    # North Korea
    "P5": "AS", "HM": "AS",
    # India
    "AT": "AS", "AU": "AS", "AV": "AS", "AW": "AS", "VU": "AS",
    # Pakistan
    "AP": "AS",
    # Bangladesh / Sri Lanka / Nepal / Bhutan / Maldives
    "S2": "AS", "S3": "AS", "4S": "AS", "9N": "AS", "A5": "AS", "8Q": "AS",
    # Myanmar / Thailand / Vietnam / Laos / Cambodia
    "XZ": "AS", "HS": "AS", "E2": "AS",
    "3W": "AS", "XV": "AS", "XW": "AS", "XU": "AS",
    # Malaysia / Singapore / Brunei
    "9M": "AS", "S6": "AS", "9V": "AS", "V8": "AS",
    # Indonesia
    "YB": "AS", "YC": "AS", "YD": "AS", "YE": "AS", "YF": "AS",
    "YG": "AS", "YH": "AS",
    "PK": "AS", "PL": "AS", "PM": "AS", "PN": "AS", "PO": "AS",
    # Philippines
    "DU": "AS", "DV": "AS", "DW": "AS", "DX": "AS", "DY": "AS", "DZ": "AS",
    "4D": "AS", "4E": "AS", "4F": "AS", "4G": "AS", "4H": "AS", "4I": "AS",
    # Taiwan
    "BM": "AS", "BN": "AS", "BO": "AS", "BP": "AS", "BQ": "AS",
    "BU": "AS", "BV": "AS", "BX": "AS",
    # Mongolia
    "JT": "AS", "JU": "AS", "JV": "AS",
    # Kazakhstan / Uzbekistan / Kyrgyzstan / Tajikistan / Turkmenistan
    "UN": "AS", "UO": "AS", "UP": "AS", "UQ": "AS",
    "UK": "AS", "EX": "AS", "EY": "AS", "EZ": "AS",
    # Caucasus: Armenia / Azerbaijan / Georgia
    "EK": "AS", "4J": "AS", "4K": "AS", "4L": "AS",
    # Middle East
    "4X": "AS", "4Z": "AS",   # Israel
    "JY": "AS",                # Jordan
    "HZ": "AS",                # Saudi Arabia
    "9K": "AS",                # Kuwait
    "A6": "AS",                # UAE
    "A7": "AS",                # Qatar
    "A9": "AS",                # Bahrain
    "A4": "AS",                # Oman
    "7O": "AS",                # Yemen
    "YI": "AS",                # Iraq
    "YK": "AS",                # Syria
    "OD": "AS",                # Lebanon
    "EP": "AS", "EQ": "AS",   # Iran
    "TA": "AS", "TB": "AS", "TC": "AS", "YM": "AS",  # Turkey
    # Central / South Asia
    "T6": "AS", "YA": "AS",   # Afghanistan
    "4W": "AS",                # Timor-Leste
    "E4": "AS",                # Palestine
    "1B": "AS",                # Northern Cyprus

    # ── Africa ─────────────────────────────────────────────────────────────
    # South Africa
    "ZR": "AF", "ZS": "AF", "ZT": "AF", "ZU": "AF",
    # Egypt / Morocco / Algeria / Tunisia / Libya
    "SU": "AF",
    "CN": "AF",
    "7T": "AF", "7U": "AF", "7V": "AF", "7W": "AF", "7X": "AF", "7Y": "AF",
    "3V": "AF", "TS": "AF",
    "5A": "AF",
    # Sub-Saharan
    "5N": "AF",   # Nigeria
    "ET": "AF",   # Ethiopia
    "EL": "AF", "D5": "AF", "A8": "AF",  # Liberia
    "5Z": "AF",   # Kenya
    "5H": "AF",   # Tanzania
    "5X": "AF",   # Uganda
    "9G": "AF",   # Ghana
    "TU": "AF",   # Ivory Coast
    "TJ": "AF",   # Cameroon
    "6W": "AF",   # Senegal
    "TZ": "AF",   # Mali
    "5U": "AF",   # Niger
    "ST": "AF",   # Sudan
    "5R": "AF",   # Madagascar
    "C8": "AF", "C9": "AF",  # Mozambique
    "Z2": "AF",   # Zimbabwe
    "9I": "AF", "9J": "AF",  # Zambia
    "7Q": "AF",   # Malawi
    "D2": "AF", "D3": "AF",  # Angola
    "V5": "AF",   # Namibia
    "A2": "AF", "8O": "AF",  # Botswana
    "9X": "AF",   # Rwanda
    "9U": "AF",   # Burundi
    "D6": "AF",   # Comoros
    "S7": "AF",   # Seychelles
    "D4": "AF",   # Cape Verde
    "S9": "AF",   # Sao Tome
    "3C": "AF",   # Equatorial Guinea
    "TR": "AF",   # Gabon
    "TN": "AF",   # Republic of Congo
    "9O": "AF", "9P": "AF", "9Q": "AF", "9R": "AF", "9S": "AF", "9T": "AF",  # DR Congo
    "TL": "AF",   # Central African Republic
    "TT": "AF",   # Chad
    "E3": "AF",   # Eritrea
    "J2": "AF",   # Djibouti
    "T5": "AF",   # Somalia
    "9L": "AF",   # Sierra Leone
    "3X": "AF",   # Guinea
    "J5": "AF",   # Guinea-Bissau
    "C5": "AF",   # Gambia
    "5T": "AF",   # Mauritania
    "S0": "AF",   # Western Sahara
    "TY": "AF",   # Benin
    "5V": "AF",   # Togo
    "XT": "AF",   # Burkina Faso
    "3B": "AF",   # Mauritius
    "FR": "AF",   # Reunion
    "FH": "AF",   # Mayotte
    "EA8": "AF",  # Canary Islands (Spain, but AF zone)
    "EA9": "AF",  # Ceuta/Melilla
    "ZD7": "AF", "ZD8": "AF", "ZD9": "AF",  # St. Helena, Ascension, Tristan
    "5W": "AF",   # Note: 5W is actually Samoa (OC) - handled by OC section

    # ── Oceania ─────────────────────────────────────────────────────────────
    # Australia
    "VH": "OC", "VI": "OC", "VJ": "OC", "VK": "OC", "VL": "OC",
    "VM": "OC", "VN": "OC",
    # New Zealand
    "ZK": "OC", "ZL": "OC", "ZM": "OC",
    # Papua New Guinea
    "P2": "OC",
    # Hawaii
    "KH6": "OC", "WH6": "OC", "AH6": "OC",
    # Guam / Mariana Islands
    "KH2": "OC", "WH2": "OC", "AH2": "OC", "KH0": "OC",
    # Pacific island entities
    "V7": "OC",   # Marshall Islands
    "V6": "OC",   # Micronesia
    "T8": "OC",   # Palau
    "YJ": "OC",   # Vanuatu
    "H4": "OC",   # Solomon Islands
    "C2": "OC",   # Nauru
    "T3": "OC",   # Kiribati
    "T2": "OC",   # Tuvalu
    "A3": "OC",   # Tonga
    "3D2": "OC",  # Fiji
    "FO": "OC",   # French Polynesia / Clipperton  (Clipperton is NA-adjacent but classified OC)
    "FK": "OC",   # New Caledonia
    "FW": "OC",   # Wallis & Futuna
    "E5": "OC",   # Cook Islands
    "E6": "OC",   # Niue
    "VP6": "OC",  # Pitcairn
    "KH8": "OC",  # American Samoa
    # Override 5W (Samoa, OC) — wins over the AF entry for "5W" key above
    "5W": "OC",
}

# Longer specific prefixes that override shorter ones must be placed in a
# separate sorted lookup so we try longer matches first.
_SORTED_PREFIXES = sorted(_PREFIX_CONT.keys(), key=len, reverse=True)


def _callsign_to_continent(raw: str) -> str:
    """Return a continent code for a callsign, or '' if unknown."""
    call = raw.upper().strip()
    # For portable/mobile callsigns take the piece that has a digit (base call)
    if "/" in call:
        parts = call.split("/")
        # prefer part with digit that is not just a suffix like P, M, MM, AM
        base = next(
            (p for p in parts if any(c.isdigit() for c in p) and len(p) > 2),
            parts[0],
        )
        call = base

    # Find where the first digit sits
    digit_pos = next((i for i, c in enumerate(call) if c.isdigit()), len(call))

    if digit_pos == 0:
        # Numeric-start prefix (9A, 3B, 7X …): extract 2–3 char prefix
        candidates = [call[:3], call[:2]]
    else:
        # Normal callsign: letters before the first digit form the prefix
        raw_pfx = call[:digit_pos]
        # Try the full prefix and progressively shorter substrings
        candidates = [raw_pfx[:l] for l in range(len(raw_pfx), 0, -1)]

    for pfx in candidates:
        if pfx in _PREFIX_CONT:
            return _PREFIX_CONT[pfx]
    return ""


def _freq_to_band(freq_khz: float) -> str | None:
    for lo, hi, band in FREQ_BANDS:
        if lo <= freq_khz <= hi:
            return band
    return None


async def _fetch_spots(count: int = 200) -> list[dict[str, Any]]:
    """Fetch recent spots from DXWatch.
    Response format: {"s": {id: [spotter, freq, dx_call, comment, time_str, age_sec, ?, mode]}}
    field[5] = age in seconds since spot was posted.
    """
    params = {"s": "0", "r": str(count)}
    headers = {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept": "application/json, */*",
    }
    async with aiohttp.ClientSession(headers=headers) as session:
        async with session.get(
            DXWATCH_URL,
            params=params,
            timeout=aiohttp.ClientTimeout(total=15),
            allow_redirects=True,
        ) as resp:
            resp.raise_for_status()
            data = await resp.json(content_type=None)
            # DXWatch returns {"s": {spot_id: [spotter, freq, dx_call, comment, time_str, age_sec, ?, mode]}}
            raw = data.get("s", {})
            return [
                {
                    "de_call": v[0],
                    "freq":    v[1],
                    "dx_call": v[2],
                    "comment": v[3],
                    "age_sec": v[5],   # seconds since the spot was posted
                }
                for v in raw.values()
                if isinstance(v, list) and len(v) >= 6
            ]


def _empty_counts() -> dict[str, dict[str, int]]:
    return {b: {c: 0 for c in CONTINENTS} for b in BANDS}


@router.get("/spots")
async def get_band_activity(
    region: str = Query("NA"),
    _: User = Depends(get_current_user),
):
    region = region.upper()
    max_age = 3600  # 60 minutes

    try:
        spots = await _fetch_spots()
    except Exception:
        return {
            "region": region,
            "bands": BANDS,
            "continents": CONTINENTS,
            "counts": _empty_counts(),
        }

    counts = _empty_counts()

    for spot in spots:
        # Time filter
        try:
            age = int(spot["age_sec"])
        except (TypeError, ValueError):
            continue
        if age > max_age:
            continue

        # Spotter must be in the selected region
        de_cont = _callsign_to_continent(spot.get("de_call") or "")
        if de_cont != region:
            continue

        # Map frequency to band
        try:
            freq = float(spot.get("freq") or 0)
        except (TypeError, ValueError):
            continue
        band = _freq_to_band(freq)
        if not band:
            continue

        # DX station continent → heatmap column
        dx_cont = _callsign_to_continent(spot.get("dx_call") or "")
        if dx_cont not in CONTINENTS:
            continue

        counts[band][dx_cont] += 1

    return {
        "region": region,
        "bands": BANDS,
        "continents": CONTINENTS,
        "counts": counts,
    }
