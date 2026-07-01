import requests
import time

locations = [{"latitude": 48.8566 + (i*0.01), "longitude": 2.3522} for i in range(100)]
start = time.time()
resp = requests.post("https://api.open-elevation.com/api/v1/lookup", json={"locations": locations})
print("Status:", resp.status_code)
print("Time:", time.time() - start)
if resp.status_code == 200:
    print("Elevations:", len(resp.json()["results"]))
