const R = 6378.137; // Earth radius in km

function toRadians(degrees) {
    return degrees * Math.PI / 180;
}

function toDegrees(radians) {
    return radians * 180 / Math.PI;
}

function projectPoint(lat, lon, bearingDeg, distanceNm) {
    const d = distanceNm * 1.852; // Distance in km
    
    const lat1 = toRadians(lat);
    const lon1 = toRadians(lon);
    const brng = toRadians(bearingDeg);
    
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d / R) +
                     Math.cos(lat1) * Math.sin(d / R) * Math.cos(brng));
    const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(d / R) * Math.cos(lat1),
                             Math.cos(d / R) - Math.sin(lat1) * Math.sin(lat2));
    
    return { lat: toDegrees(lat2), lon: toDegrees(lon2) };
}

function findRaCrossings(runwayConfigs, samples, targetRaFt) {
    // Group samples by runway
    const grouped = {};
    samples.forEach(s => {
        if (!grouped[s.source_row_index]) {
            grouped[s.source_row_index] = [];
        }
        grouped[s.source_row_index].push(s);
    });

    const results = [];

    runwayConfigs.forEach(rw => {
        const prof = grouped[rw.source_row_index] || [];
        // Sort by distance_nm
        prof.sort((a, b) => a.distance_nm - b.distance_nm);

        const res = {
            runway: rw.runway,
            ra1000_status: "NOT_COMPUTED"
        };

        if (prof.length < 2) {
            res.ra1000_status = "INSUFFICIENT_PROFILE";
            results.push(res);
            return;
        }

        // Calculate terrain AAE and radio altitude for each point
        prof.forEach(p => {
            if (p.terrain_elevation_ft === null || p.terrain_elevation_ft === undefined) {
                p.terrain_aae_ft = null;
                p.radio_altitude_ft = null;
            } else {
                p.terrain_aae_ft = p.terrain_elevation_ft - p.operational_threshold_elevation_ft;
                p.radio_altitude_ft = p.aircraft_aae_ft - p.terrain_aae_ft;
            }
        });

        let crossingFound = false;

        for (let i = 0; i < prof.length - 1; i++) {
            const p1 = prof[i];
            const p2 = prof[i + 1];

            const ra1 = p1.radio_altitude_ft;
            const ra2 = p2.radio_altitude_ft;

            if (ra1 === null || ra1 === undefined || isNaN(ra1) ||
                ra2 === null || ra2 === undefined || isNaN(ra2)) {
                continue;
            }

            if ((ra1 <= targetRaFt && ra2 >= targetRaFt) || (ra1 >= targetRaFt && ra2 <= targetRaFt)) {
                const denom = ra2 - ra1;
                let ratio = 0.0;
                if (Math.abs(denom) > 1e-9) {
                    ratio = (targetRaFt - ra1) / denom;
                }

                const dInterp = p1.distance_nm + ratio * (p2.distance_nm - p1.distance_nm);
                const projected = projectPoint(
                    p1.operational_threshold_lat,
                    p1.operational_threshold_lon,
                    p1.outward_bearing_degT,
                    dInterp
                );

                const acAaeInterp = p1.aircraft_aae_ft + ratio * (p2.aircraft_aae_ft - p1.aircraft_aae_ft);
                const terrainAaeInterp = p1.terrain_aae_ft + ratio * (p2.terrain_aae_ft - p1.terrain_aae_ft);
                const terrainElevInterp = p1.terrain_elevation_ft + ratio * (p2.terrain_elevation_ft - p1.terrain_elevation_ft);

                res.ra1000_status = "OK";
                res.distance_nm_at_ra1000 = dInterp;
                res.lat_at_ra1000 = projected.lat;
                res.lon_at_ra1000 = projected.lon;
                res.terrain_elevation_ft_at_ra1000 = terrainElevInterp;
                res.delta_threshold_minus_terrain_at_ra1000_ft = p1.operational_threshold_elevation_ft - terrainElevInterp;
                
                crossingFound = true;
                break;
            }
        }

        if (!crossingFound) {
            const validRAs = prof.map(p => p.radio_altitude_ft).filter(r => r !== null && !isNaN(r));
            if (validRAs.length > 0) {
                const minRa = Math.min(...validRAs);
                const maxRa = Math.max(...validRAs);
                if (maxRa < targetRaFt) {
                    res.ra1000_status = "NO_CROSSING_TOO_LOW_WITHIN_WINDOW";
                } else if (minRa > targetRaFt) {
                    res.ra1000_status = "NO_CROSSING_ALREADY_ABOVE_TARGET";
                } else {
                    res.ra1000_status = "NO_CROSSING_IN_SEARCH_WINDOW";
                }
            } else {
                res.ra1000_status = "NO_VALID_TERRAIN_DATA";
            }
        }
        
        results.push(res);
    });

    return results;
}
