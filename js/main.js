async function drawStateMap() {
  try {
    const boundaryUrl =
      "https://geo.abs.gov.au/arcgis/rest/services/ASGS2026/STE/MapServer/1/query?where=1%3D1&outFields=STATE_CODE_2026%2CSTATE_NAME_2026&returnGeometry=true&outSR=4326&f=geojson";

    const [csvResponse, mapResponse, specResponse] = await Promise.all([
      fetch("data/threatened_species_states.csv"),
      fetch(boundaryUrl),
      fetch("charts/charts/state_choropleth.vl.json")
    ]);

    if (!csvResponse.ok || !mapResponse.ok || !specResponse.ok) {
      throw new Error("Could not load the CSV, map boundaries, or chart specification.");
    }

    const csvText = await csvResponse.text();
    const rows = vega.read(csvText, { type: "csv", parse: "auto" });
    const geojson = await mapResponse.json();
    const spec = await specResponse.json();

    const stateCodeByName = {
      "Australian Capital Territory": "ACT",
      "New South Wales": "NSW",
      "Northern Territory": "NT",
      "Queensland": "QLD",
      "South Australia": "SA",
      "Tasmania": "TAS",
      "Victoria": "VIC",
      "Western Australia": "WA"
    };

    const features = geojson.features.filter(
      feature => stateCodeByName[feature.properties.STATE_NAME_2026]
    );

    for (const feature of features) {
      const stateCode = stateCodeByName[feature.properties.STATE_NAME_2026];

      feature.properties.listed_taxa = rows.filter(
        row => row[stateCode] === "Yes"
      ).length;
    }

    spec.data = { values: features };

    await vegaEmbed("#vis-state-map", spec, { actions: false });
    console.log("State map loaded.");
  } catch (error) {
    console.error("Could not draw the state map:", error);
  }
}

drawStateMap();