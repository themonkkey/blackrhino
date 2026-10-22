"""Build airports.json (Indian airports + runways) from OurAirports CSVs.
Refresh: curl -O https://davidmegginson.github.io/ourairports-data/{airports,runways}.csv"""
import csv, json, os
here = os.path.dirname(os.path.abspath(__file__))
keep = {}
for r in csv.DictReader(open(os.path.join(here, "airports.csv"), encoding="utf-8")):
    if r["iso_country"] != "IN" or r["type"] not in ("large_airport", "medium_airport", "small_airport"):
        continue
    if r["type"] == "small_airport" and r["scheduled_service"] != "yes":
        continue
    icao = r["gps_code"] or r["icao_code"] or r["ident"]
    keep[r["ident"]] = {
        "icao": icao, "iata": r["iata_code"] or None, "name": r["name"], "city": r["municipality"],
        "state": r["iso_region"].replace("IN-", ""), "lat": round(float(r["latitude_deg"]), 5),
        "lon": round(float(r["longitude_deg"]), 5),
        "elev": int(r["elevation_ft"]) if r["elevation_ft"] else None,
        "type": r["type"].split("_")[0], "sched": r["scheduled_service"] == "yes", "runways": []}
for r in csv.DictReader(open(os.path.join(here, "runways.csv"), encoding="utf-8")):
    a = keep.get(r["airport_ident"])
    if not a or r["closed"] == "1" or not all(r[k] for k in ("le_latitude_deg", "le_longitude_deg", "he_latitude_deg", "he_longitude_deg")):
        continue
    a["runways"].append({"id": f'{r["le_ident"]}/{r["he_ident"]}', "len": int(r["length_ft"] or 0),
                         "surf": r["surface"], "lit": r["lighted"] == "1",
                         "pts": [round(float(r[k]), 5) for k in ("le_latitude_deg", "le_longitude_deg", "he_latitude_deg", "he_longitude_deg")]})
out = sorted(keep.values(), key=lambda a: ({"large": 0, "medium": 1, "small": 2}[a["type"]], a["icao"]))
json.dump(out, open(os.path.join(here, "..", "public", "airports.json"), "w"), separators=(",", ":"))
print(len(out), "airports;", sum(a["type"] == "large" for a in out), "large;", sum(a["sched"] for a in out), "scheduled;",
      sum(len(a["runways"]) for a in out), "runways with coords")
