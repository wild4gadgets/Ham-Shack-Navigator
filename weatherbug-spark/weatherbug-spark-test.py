import asyncio
import weatherbug_spark

async def check_lightning():
    data = await weatherbug_spark.get_data(
        lat=0.0, lon=0.0  # Replace with your station coordinates
    )
    print(f"Closest strike: {data.closestPulseDistance} miles")
    print(f"Alert code: {data.alertCode}")  # higher = closer
    for strike in data.pulseListAlert:
        print(strike)  # lat/lon of each strike

asyncio.run(check_lightning())

