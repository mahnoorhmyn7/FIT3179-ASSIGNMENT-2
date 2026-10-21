async function drawStateMap() {
  try {
    const [csvResponse, mapResponse, specResponse] = await Promise.all([
      fetch("data/threatened_species_states.csv"),
      fetch("https://static.geodataviewer.com/datasets/australia-states.geojson"),
      fetch("charts/charts/state_choropleth.vl.json")
    ]);

    if (!csvResponse.ok || !mapResponse.ok || !specResponse.ok) {
      throw new Error("Could not load the CSV, map, or chart specification.");
    }

    const csvText = await csvResponse.text();
    const rows = vega.read(csvText, { type: "csv", parse: "auto" });
    const geojson = await mapResponse.json();
    const spec = await specResponse.json();

    const features = geojson.features.filter(
      feature => feature.properties.shapeName !== "Other Territories"
    );

    for (const feature of features) {
      const stateCode = feature.properties.shapeISO.split("-")[1];

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