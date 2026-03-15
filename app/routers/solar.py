import asyncio
import urllib.request
from fastapi import APIRouter, Depends
from fastapi.responses import Response

from dependencies import get_current_user
from models import User

router = APIRouter(prefix="/solar", tags=["solar"])

SOLAR_XML_URL = "https://www.hamqsl.com/solarxml.php"


def _fetch_solar_xml() -> bytes:
    with urllib.request.urlopen(SOLAR_XML_URL, timeout=10) as resp:
        return resp.read()


@router.get("/data")
async def get_solar_data(_: User = Depends(get_current_user)):
    content = await asyncio.to_thread(_fetch_solar_xml)
    return Response(content=content, media_type="application/xml")
