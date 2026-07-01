document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("search-form");
    const input = document.getElementById("icao-input");
    const btn = document.getElementById("search-btn");
    const btnText = btn.querySelector("span");
    const btnSpinner = document.getElementById("btn-spinner");
    
    const loadingState = document.getElementById("loading-state");
    const errorState = document.getElementById("error-state");
    const errorMessage = document.getElementById("error-message");
    const resultsContainer = document.getElementById("results-container");

    const RUNWAYS_URL = "https://davidmegginson.github.io/ourairports-data/runways.csv";
    let runwaysData = null;

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const icao = input.value.trim().toUpperCase();
        if (!icao) return;

        // UI Loading State
        btn.disabled = true;
        btnText.textContent = "Processing...";
        btnSpinner.style.display = "block";
        
        loadingState.classList.remove("hidden");
        errorState.classList.add("hidden");
        resultsContainer.classList.add("hidden");
        resultsContainer.innerHTML = "";

        try {
            // 1. Fetch runways.csv if not cached
            if (!runwaysData) {
                const response = await fetch(RUNWAYS_URL);
                const csvText = await response.text();
                
                const parsed = Papa.parse(csvText, {
                    header: true,
                    skipEmptyLines: true,
                    dynamicTyping: true
                });
                runwaysData = parsed.data;
            }

            // 2. Filter for airport
            const airportRunways = runwaysData.filter(r => r.airport_ident === icao);
            if (airportRunways.length === 0) {
                throw new Error(`Airport ${icao} not found in OurAirports database.`);
            }

            // 3. Build runway configs
            const runwayConfigs = [];
            let idx = 0;

            for (const row of airportRunways) {
                // LE End
                if (row.le_ident && row.le_latitude_deg !== null && row.le_longitude_deg !== null) {
                    let outwardBearing = row.he_heading_degT;
                    if (outwardBearing === null && row.le_heading_degT !== null) {
                        outwardBearing = (row.le_heading_degT + 180) % 360;
                    }
                    if (outwardBearing !== null) {
                        runwayConfigs.push({
                            source_row_index: idx++,
                            runway: `${icao} ${row.le_ident}`,
                            operational_threshold_lat: row.le_latitude_deg,
                            operational_threshold_lon: row.le_longitude_deg,
                            operational_threshold_elevation_ft: row.le_elevation_ft || 0,
                            outward_bearing_degT: outwardBearing,
                            glide_angle_deg: 3.0,
                            tch_ft: 50.0
                        });
                    }
                }

                // HE End
                if (row.he_ident && row.he_latitude_deg !== null && row.he_longitude_deg !== null) {
                    let outwardBearing = row.le_heading_degT;
                    if (outwardBearing === null && row.he_heading_degT !== null) {
                        outwardBearing = (row.he_heading_degT + 180) % 360;
                    }
                    if (outwardBearing !== null) {
                        runwayConfigs.push({
                            source_row_index: idx++,
                            runway: `${icao} ${row.he_ident}`,
                            operational_threshold_lat: row.he_latitude_deg,
                            operational_threshold_lon: row.he_longitude_deg,
                            operational_threshold_elevation_ft: row.he_elevation_ft || 0,
                            outward_bearing_degT: outwardBearing,
                            glide_angle_deg: 3.0,
                            tch_ft: 50.0
                        });
                    }
                }
            }

            if (runwayConfigs.length === 0) {
                throw new Error("Runways found but missing coordinate/heading data.");
            }

            // 4. Generate profile samples (0 to 10 NM)
            const samples = [];
            for (const rw of runwayConfigs) {
                for (let step = 0; step <= 100; step++) {
                    const d_nm = step * 0.1;
                    const projected = projectPoint(
                        rw.operational_threshold_lat, 
                        rw.operational_threshold_lon, 
                        rw.outward_bearing_degT, 
                        d_nm
                    );

                    const d_ft = d_nm * 6076.11549;
                    const ac_aae_ft = d_ft * Math.tan(toRadians(rw.glide_angle_deg)) + rw.tch_ft;

                    samples.push({
                        source_row_index: rw.source_row_index,
                        distance_nm: d_nm,
                        lat: projected.lat,
                        lon: projected.lon,
                        operational_threshold_lat: rw.operational_threshold_lat,
                        operational_threshold_lon: rw.operational_threshold_lon,
                        operational_threshold_elevation_ft: rw.operational_threshold_elevation_ft,
                        outward_bearing_degT: rw.outward_bearing_degT,
                        glide_angle_deg: rw.glide_angle_deg,
                        tch_ft: rw.tch_ft,
                        aircraft_aae_ft: ac_aae_ft,
                        terrain_status: "OK",
                        terrain_elevation_ft: null // Will be populated
                    });
                }
            }

            // 5. Fetch Open-Meteo elevation data
            const elevations_m = [];
            for (let i = 0; i < samples.length; i += 100) {
                const batch = samples.slice(i, i + 100);
                const latitudes = batch.map(s => s.lat.toFixed(5)).join(",");
                const longitudes = batch.map(s => s.lon.toFixed(5)).join(",");
                
                const resp = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${latitudes}&longitude=${longitudes}`);
                if (!resp.ok) {
                    if (resp.status === 429) {
                        throw new Error("Open-Meteo API Rate Limit Exceeded. Please wait a minute and try again.");
                    }
                    throw new Error(`Open-Meteo API Error: ${resp.status}`);
                }
                const data = await resp.json();
                if (data.elevation) {
                    elevations_m.push(...data.elevation);
                } else {
                    elevations_m.push(...Array(batch.length).fill(null));
                }

                // Increased delay to respect rate limit more safely
                await new Promise(r => setTimeout(r, 250));
            }

            // Assign elevations in ft
            for (let i = 0; i < samples.length; i++) {
                if (elevations_m[i] !== null && elevations_m[i] !== undefined) {
                    samples[i].terrain_elevation_ft = elevations_m[i] * 3.28084;
                }
            }

            // 6. Run algorithm
            const results = findRaCrossings(runwayConfigs, samples, 1000.0);
            
            renderResults(results);
            
        } catch (err) {
            errorMessage.textContent = err.message;
            errorState.classList.remove("hidden");
        } finally {
            // Restore UI
            btn.disabled = false;
            btnText.textContent = "Calculate";
            btnSpinner.style.display = "none";
            loadingState.classList.add("hidden");
        }
    });

    function renderResults(results) {
        if (!results || results.length === 0) {
            errorMessage.textContent = "No runways found for this airport.";
            errorState.classList.remove("hidden");
            return;
        }

        resultsContainer.classList.remove("hidden");

        results.forEach(res => {
            const card = document.createElement("div");
            card.className = "card";

            const statusClass = getStatusClass(res.ra1000_status);
            
            let dataContent = "";
            if (res.ra1000_status === "OK") {
                const dist = parseFloat(res.distance_nm_at_ra1000).toFixed(3);
                const lat = parseFloat(res.lat_at_ra1000).toFixed(6);
                const lon = parseFloat(res.lon_at_ra1000).toFixed(6);
                const elev = parseFloat(res.terrain_elevation_ft_at_ra1000).toFixed(1);
                const delta = parseFloat(res.delta_threshold_minus_terrain_at_ra1000_ft).toFixed(1);

                dataContent = `
                    <div class="data-row">
                        <span class="data-label">Distance to RA 1000</span>
                        <span class="data-value accent-value">${dist} NM</span>
                    </div>
                    <div class="data-row">
                        <span class="data-label">Coordinates</span>
                        <span class="data-value">${lat}, ${lon}</span>
                    </div>
                    <div class="data-row">
                        <span class="data-label">Terrain Elev.</span>
                        <span class="data-value">${elev} ft</span>
                    </div>
                    <div class="data-row">
                        <span class="data-label">Delta (Threshold - Terrain)</span>
                        <span class="data-value">${delta} ft</span>
                    </div>
                `;
            } else {
                dataContent = `
                    <div class="data-row" style="flex-direction: column; align-items: flex-start; gap: 0.5rem;">
                        <span class="data-label">Details</span>
                        <span class="data-value" style="font-size: 0.9rem; color: var(--text-muted);">${res.ra1000_status}</span>
                    </div>
                `;
            }

            card.innerHTML = `
                <div class="card-header">
                    <span class="runway-id">${res.runway}</span>
                    <span class="status-badge ${statusClass}">${res.ra1000_status}</span>
                </div>
                ${dataContent}
            `;
            
            resultsContainer.appendChild(card);
        });
    }

    function getStatusClass(status) {
        if (status === "OK") return "status-ok";
        if (status.includes("NO_CROSSING") || status.includes("ERROR") || status === "INSUFFICIENT_PROFILE") return "status-warning";
        return "status-error";
    }
});
