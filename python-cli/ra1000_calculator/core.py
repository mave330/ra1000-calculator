import math
import pandas as pd

def project_point(lat, lon, bearing_deg, distance_nm):
    """
    Project a point along a great circle arc.
    """
    R = 6378.137  # Earth radius in km
    d = distance_nm * 1.852  # Distance in km
    
    lat1 = math.radians(lat)
    lon1 = math.radians(lon)
    brng = math.radians(bearing_deg)
    
    lat2 = math.asin(math.sin(lat1) * math.cos(d / R) +
                     math.cos(lat1) * math.sin(d / R) * math.cos(brng))
    lon2 = lon1 + math.atan2(math.sin(brng) * math.sin(d / R) * math.cos(lat1),
                             math.cos(d / R) - math.sin(lat1) * math.sin(lat2))
    
    return math.degrees(lat2), math.degrees(lon2)

def find_ra_crossings(df_original, df_samples, target_ra_ft):
    """
    For each runway, find the first distance where RA reaches target_ra_ft.
    Linear interpolation between two samples to find distance and exact coordinates.
    """
    results = df_original.copy()

    new_cols = [
        "ra1000_status",
        "distance_nm_at_ra1000",
        "lat_at_ra1000",
        "lon_at_ra1000",
        "aircraft_aae_ft_at_ra1000",
        "terrain_aae_ft_at_ra1000",
        "terrain_elevation_ft_at_ra1000",
        "radio_altitude_ft_check",
        "glide_angle_deg_used",
        "tch_ft_used",
        "ra1000_interp_from_nm",
        "ra1000_interp_to_nm",
    ]

    for c in new_cols:
        results[c] = pd.NA

    grouped = df_samples[df_samples["terrain_status"] == "OK"].copy()

    if grouped.empty:
        results["ra1000_status"] = "NO_TERRAIN_DATA"
        return results

    grouped["terrain_elevation_ft"] = pd.to_numeric(grouped["terrain_elevation_ft"], errors="coerce")
    grouped["operational_threshold_elevation_ft"] = pd.to_numeric(grouped["operational_threshold_elevation_ft"], errors="coerce")
    grouped["terrain_aae_ft"] = grouped["terrain_elevation_ft"] - grouped["operational_threshold_elevation_ft"]
    grouped["radio_altitude_ft"] = grouped["aircraft_aae_ft"] - grouped["terrain_aae_ft"]

    for row_index, prof in grouped.groupby("source_row_index"):
        prof = prof.sort_values("distance_nm").reset_index(drop=True)

        if len(prof) < 2:
            results.at[row_index, "ra1000_status"] = "INSUFFICIENT_PROFILE"
            continue

        crossing_found = False

        for i in range(len(prof) - 1):
            p1 = prof.iloc[i]
            p2 = prof.iloc[i + 1]

            ra1 = p1["radio_altitude_ft"]
            ra2 = p2["radio_altitude_ft"]

            if pd.isna(ra1) or pd.isna(ra2):
                continue

            if ra1 <= target_ra_ft <= ra2:
                denom = ra2 - ra1
                ratio = 0.0 if abs(denom) < 1e-9 else (target_ra_ft - ra1) / denom

                d_interp = p1["distance_nm"] + ratio * (p2["distance_nm"] - p1["distance_nm"])
                lat_interp, lon_interp = project_point(
                    p1["operational_threshold_lat"],
                    p1["operational_threshold_lon"],
                    p1["outward_bearing_degT"],
                    d_interp
                )

                ac_aae_interp = p1["aircraft_aae_ft"] + ratio * (p2["aircraft_aae_ft"] - p1["aircraft_aae_ft"])
                terrain_aae_interp = p1["terrain_aae_ft"] + ratio * (p2["terrain_aae_ft"] - p1["terrain_aae_ft"])
                terrain_elev_interp = p1["terrain_elevation_ft"] + ratio * (p2["terrain_elevation_ft"] - p1["terrain_elevation_ft"])

                results.at[row_index, "ra1000_status"] = "OK"
                results.at[row_index, "distance_nm_at_ra1000"] = d_interp
                results.at[row_index, "lat_at_ra1000"] = lat_interp
                results.at[row_index, "lon_at_ra1000"] = lon_interp
                results.at[row_index, "aircraft_aae_ft_at_ra1000"] = ac_aae_interp
                results.at[row_index, "terrain_aae_ft_at_ra1000"] = terrain_aae_interp
                results.at[row_index, "terrain_elevation_ft_at_ra1000"] = terrain_elev_interp
                results.at[row_index, "radio_altitude_ft_check"] = (ac_aae_interp - terrain_aae_interp)
                results.at[row_index, "glide_angle_deg_used"] = p1["glide_angle_deg"]
                results.at[row_index, "tch_ft_used"] = p1["tch_ft"]
                results.at[row_index, "ra1000_interp_from_nm"] = p1["distance_nm"]
                results.at[row_index, "ra1000_interp_to_nm"] = p2["distance_nm"]

                crossing_found = True
                break

        if not crossing_found:
            min_ra = prof["radio_altitude_ft"].min()
            max_ra = prof["radio_altitude_ft"].max()

            if pd.notna(max_ra) and max_ra < target_ra_ft:
                results.at[row_index, "ra1000_status"] = "NO_CROSSING_TOO_LOW_WITHIN_WINDOW"
            elif pd.notna(min_ra) and min_ra > target_ra_ft:
                results.at[row_index, "ra1000_status"] = "NO_CROSSING_ALREADY_ABOVE_TARGET"
            else:
                results.at[row_index, "ra1000_status"] = "NO_CROSSING_IN_SEARCH_WINDOW"

    results["ra1000_status"] = results["ra1000_status"].fillna("NOT_COMPUTED")
    return results
