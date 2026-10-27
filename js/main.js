
const chartSettings = {
  actions: false,
  renderer: "svg"
};

// ============================================
// FILE AND DATA HELPERS
// ============================================

async function loadCSV(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`${path}: HTTP ${response.status}`);
  }
  return vega.read(await response.text(), { type: "csv" });
}

async function loadJSON(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`${path}: HTTP ${response.status}`);
  }
  return response.json();
}

function reportError(id, error) {
  console.error(`Error loading ${id}:`, error);
  const element = document.getElementById(id);
  if (element) {
    element.textContent = `Chart could not be loaded: ${error.message}`;
  }
}

async function drawChart(id, path) {
  const element = document.getElementById(id);
  if (!element) return;

  try {
    const spec = await loadJSON(path);

    if (id === "vis-treemap") {
      spec.width = Math.max(
        230,
        Math.min(900, element.clientWidth - 48)
      );
    }

    await vegaEmbed(`#${id}`, spec, chartSettings);
    console.log(`${id} loaded successfully`);
  } catch (error) {
    reportError(id, error);
  }
}

function findColumn(rows, candidates) {
  const headers = Object.keys(rows[0] || {});
  const normalize = value =>
    String(value).toLowerCase().replace(/[^a-z0-9]/g, "");

  for (const candidate of candidates) {
    const exact = headers.find(
      header => normalize(header) === normalize(candidate)
    );
    if (exact) return exact;
  }

  for (const candidate of candidates) {
    const partial = headers.find(
      header => normalize(header).includes(normalize(candidate))
    );
    if (partial) return partial;
  }

  return null;
}

// ============================================
// SHARED AUSTRALIAN DATA HELPERS
// ============================================

const stateCodes = {
  "New South Wales": "NSW",
  "Victoria": "VIC",
  "Queensland": "QLD",
  "Western Australia": "WA",
  "South Australia": "SA",
  "Tasmania": "TAS",
  "Northern Territory": "NT",
  "Australian Capital Territory": "ACT"
};

const australiaBounds = {
  west: 110,
  east: 160,
  south: -46,
  north: -9
};

function isPresent(row, code) {
  return String(row[code] ?? "")
    .trim()
    .toLowerCase() === "yes";
}

function countListedTaxa(rows, code) {
  return rows.filter(row => isPresent(row, code)).length;
}

function ringWithinAustralia(ring) {
  return Array.isArray(ring) &&
    ring.length >= 4 &&
    ring.every(point =>
      Array.isArray(point) &&
      Number.isFinite(point[0]) &&
      Number.isFinite(point[1]) &&
      point[0] >= australiaBounds.west &&
      point[0] <= australiaBounds.east &&
      point[1] >= australiaBounds.south &&
      point[1] <= australiaBounds.north
    );
}

function ringSignedArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    area +=
      ring[i][0] * ring[i + 1][1] -
      ring[i + 1][0] * ring[i][1];
  }
  return area / 2;
}

function orientRing(ring, isOuter) {
  const copy = ring.map(point => [...point]);
  const shouldReverse = isOuter
    ? ringSignedArea(copy) > 0
    : ringSignedArea(copy) < 0;
  return shouldReverse ? copy.reverse() : copy;
}

function cleanPolygon(polygon) {
  if (
    !Array.isArray(polygon) ||
    !polygon.length ||
    !ringWithinAustralia(polygon[0])
  ) {
    return null;
  }

  const rings = [orientRing(polygon[0], true)];

  for (const hole of polygon.slice(1)) {
    if (ringWithinAustralia(hole)) {
      rings.push(orientRing(hole, false));
    }
  }

  return rings;
}

function cleanGeometry(geometry) {
  if (!geometry) return null;

  if (geometry.type === "Polygon") {
    const polygon = cleanPolygon(geometry.coordinates);
    return polygon
      ? { type: "Polygon", coordinates: polygon }
      : null;
  }

  if (geometry.type === "MultiPolygon") {
    const polygons = geometry.coordinates
      .map(cleanPolygon)
      .filter(Boolean);

    return polygons.length
      ? { type: "MultiPolygon", coordinates: polygons }
      : null;
  }

  return null;
}

function prepareAustralianFeatures(geojson) {
  if (!Array.isArray(geojson.features)) {
    throw new Error("Invalid GeoJSON feature collection");
  }

  return geojson.features
    .filter(feature =>
      Object.prototype.hasOwnProperty.call(
        stateCodes,
        feature.properties?.STATE_NAME
      )
    )
    .map(feature => {
      const geometry = cleanGeometry(feature.geometry);
      return geometry
        ? {
            type: "Feature",
            geometry,
            properties: { ...feature.properties }
          }
        : null;
    })
    .filter(Boolean);
}

function assertEightStates(features) {
  const names = new Set(
    features.map(feature => feature.properties.STATE_NAME)
  );

  if (names.size !== 8) {
    throw new Error(
      "Australian geographic data must contain eight states and territories"
    );
  }
}

// ============================================
// FIGURE 01 — AUSTRALIAN CHOROPLETH
// ============================================

async function drawStateMap() {
  try {
    const [rows, geojson, spec] = await Promise.all([
      loadCSV("data/threatened_animals.csv"),
      loadJSON("data/australia_states.geojson"),
      loadJSON("charts/state_choropleth.vl.json")
    ]);

    const features = prepareAustralianFeatures(geojson);
    assertEightStates(features);

    for (const feature of features) {
      const state = feature.properties.STATE_NAME;
      feature.properties.state_name = state;
      feature.properties.listed_taxa =
        countListedTaxa(rows, stateCodes[state]);
    }

    spec.data = { values: features };

    await vegaEmbed("#vis-state-map", spec, chartSettings);
    console.log("Choropleth loaded successfully");
  } catch (error) {
    reportError("vis-state-map", error);
  }
}

// ============================================
// FIGURE 07 — WORLD NON-CONTIGUOUS CARTOGRAM
// ============================================

async function drawWorldCartogram() {
  try {
    if (
      typeof d3 === "undefined" ||
      typeof topojson === "undefined"
    ) {
      throw new Error(
        "D3 and TopoJSON libraries must load before main.js"
      );
    }

    const [rows, topology, spec] = await Promise.all([
      loadCSV("data/zoo_wildlife_releases.csv"),
      loadJSON(
        "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json"
      ),
      loadJSON("charts/world_noncontiguous_cartogram.vg.json")
    ]);

    if (
      !rows.length ||
      !("transl.country" in rows[0]) ||
      !("outcome" in rows[0])
    ) {
      throw new Error(
        "Expected transl.country and outcome columns in release CSV"
      );
    }

    const countryCounts = new Map();
    let jointCountryRecords = 0;

    for (const row of rows) {
      const raw = String(
        row["transl.country"] ?? ""
      ).trim();

      if (!raw || raw === "NA") continue;

      if (raw === "Congo + Gabon") {
        jointCountryRecords++;
        continue;
      }

      const country =
        raw === "Hong Kong (China)" ? "China" : raw;

      if (!countryCounts.has(country)) {
        countryCounts.set(country, {
          country,
          count: 0,
          success: 0
        });
      }

      const item = countryCounts.get(country);
      item.count++;

      if (
        String(row.outcome ?? "")
          .trim()
          .toLowerCase() === "success"
      ) {
        item.success++;
      }
    }

    const normalise = name =>
      String(name)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

    const aliases = {
      "united states": "united states of america",
      "hong kong china": "china"
    };

    const statsByName = new Map();

    for (const [country, value] of countryCounts) {
      const key = normalise(country);
      statsByName.set(
        normalise(aliases[key] || country),
        value
      );
    }

    const worldFeatures = topojson
      .feature(topology, topology.objects.countries)
      .features
      .filter(feature => String(feature.id) !== "010");

    const width = 980;
    const height = 510;

    const projection = d3.geoEqualEarth().fitExtent(
      [[30, 25], [width - 30, height - 24]],
      {
        type: "FeatureCollection",
        features: worldFeatures
      }
    );

    const basePath = d3.geoPath(projection);

    const background = worldFeatures
      .map(feature => ({
        path: basePath(feature) || ""
      }))
      .filter(item => item.path);

    const countries = [];
    const labels = [];
    const matched = new Set();

    for (const feature of worldFeatures) {
      const mapName = feature.properties?.name || "";
      const key = normalise(mapName);
      const data = statsByName.get(key);

      if (!data) continue;

      matched.add(key);

      const originalArea = basePath.area(feature);

      if (!(originalArea > 0.001)) continue;

      // Projected area is proportional to study count.
      const targetArea = data.count * 145;
      const factor = Math.sqrt(
        targetArea / originalArea
      );

      const [cx, cy] = basePath.centroid(feature);

      if (
        !Number.isFinite(cx) ||
        !Number.isFinite(cy)
      ) {
        continue;
      }

      // Scale the projected country outline around
      // the country's geographic centroid.
      const transformProjection = d3.geoTransform({
        point(lon, lat) {
          const p = projection([lon, lat]);

          if (p) {
            this.stream.point(
              cx + (p[0] - cx) * factor,
              cy + (p[1] - cy) * factor
            );
          }
        }
      });

      const shape = d3.geoPath(
        transformProjection
      )(feature);

      if (!shape) continue;

      const successRate =
        data.success / data.count;

      countries.push({
        path: shape,
        country: data.country,
        count: data.count,
        success: data.success,
        successRate,
        successLabel:
          `${(successRate * 100).toFixed(1)}%`,
        scaledArea: Math.round(targetArea)
      });

      if (data.count >= 3) {
        const abbreviated =
          data.country === "United States"
            ? "USA"
            : data.country === "United Kingdom"
            ? "UK"
            : data.country === "New Zealand"
            ? "NZ"
            : data.country;

        labels.push({
          x: cx,
          y: cy,
          label: abbreviated,
          count: data.count
        });
      }
    }

    const unmatched = [...statsByName.keys()]
      .filter(key => !matched.has(key));

    if (unmatched.length) {
      console.warn(
        "Cartogram countries not matched:",
        unmatched
      );
    }

    if (!countries.length) {
      throw new Error(
        "No country geometries matched release records"
      );
    }

    const datasets = {
      background,
      countries,
      labels
    };

    for (const dataset of spec.data) {
      if (
        Object.prototype.hasOwnProperty.call(
          datasets,
          dataset.name
        )
      ) {
        dataset.values = datasets[dataset.name];
      }
    }

    await vegaEmbed(
      "#vis-grant-map",
      spec,
      chartSettings
    );

    console.log("World cartogram loaded:", {
      countries: countries.length,
      mappedRecords: countries.reduce(
        (sum, item) => sum + item.count,
        0
      ),
      jointCountryRecords,
      unmatched
    });
  } catch (error) {
    reportError("vis-grant-map", error);
  }
}

// ============================================
// FIGURE 08 — UPSET PLOT
// ============================================

async function drawUpSetPlot() {
  try {
    const [rows, spec] = await Promise.all([
      loadCSV("data/threatened_animals.csv"),
      loadJSON("charts/state_overlap_upset.vg.json")
    ]);

    const stateOrder = [
      "WA", "NT", "QLD", "SA",
      "NSW", "ACT", "VIC", "TAS"
    ];

    if (!rows.length) {
      throw new Error(
        "Threatened animals CSV is empty"
      );
    }

    for (const code of stateOrder) {
      if (!(code in rows[0])) {
        throw new Error(
          `Missing state occurrence column: ${code}`
        );
      }
    }

    const combinationCounts = new Map();
    let excludedRows = 0;

    for (const row of rows) {
      const includedStates = stateOrder.filter(
        code => isPresent(row, code)
      );

      if (!includedStates.length) {
        excludedRows++;
        continue;
      }

      const key = includedStates.join("|");
      combinationCounts.set(
        key,
        (combinationCounts.get(key) || 0) + 1
      );
    }

    const topCombinations =
      [...combinationCounts.entries()]
        .map(([key, count]) => ({
          includedStates: key.split("|"),
          count
        }))
        .sort((a, b) =>
          b.count - a.count ||
          a.includedStates.join("|").localeCompare(
            b.includedStates.join("|")
          )
        )
        .slice(0, 12);

    if (!topCombinations.length) {
      throw new Error(
        "No valid state combinations found"
      );
    }

    const combinations =
      topCombinations.map((item, index) => ({
        id: index,
        label: item.includedStates.join(" + "),
        count: item.count
      }));

    const matrix = [];
    const connections = [];

    topCombinations.forEach((item, index) => {
      const label = item.includedStates.join(" + ");

      for (const state of stateOrder) {
        matrix.push({
          id: index,
          state,
          active: item.includedStates.includes(state),
          label,
          count: item.count
        });
      }

      if (item.includedStates.length >= 2) {
        connections.push({
          id: index,
          first: item.includedStates[0],
          last: item.includedStates[
            item.includedStates.length - 1
          ]
        });
      }
    });

    const states = stateOrder.map(
      code => ({ code })
    );

    const element =
      document.getElementById("vis-upset");

    if (!element) {
      throw new Error("UpSet container not found");
    }

    spec.width = Math.min(
      880,
      Math.max(560, element.clientWidth - 35)
    );

    const values = {
      combinations,
      matrix,
      connections,
      states
    };

    for (const dataset of spec.data) {
      if (
        Object.prototype.hasOwnProperty.call(
          values,
          dataset.name
        )
      ) {
        dataset.values = values[dataset.name];
      }
    }

    await vegaEmbed(
      "#vis-upset",
      spec,
      chartSettings
    );

    console.log(
      `UpSet loaded: ${combinations.length} combinations; ${excludedRows} records excluded`
    );
  } catch (error) {
    reportError("vis-upset", error);
  }
}

// ============================================
// FIGURE 09 — SANKEY DIAGRAM
// ============================================

async function drawReleaseSankey() {
  try {
    const [rows, spec] = await Promise.all([
      loadCSV("data/zoo_wildlife_releases.csv"),
      loadJSON("charts/zoo_release_sankey.vg.json")
    ]);

    if (!rows.length) {
      throw new Error(
        "Release CSV contains no records"
      );
    }

    const groupCol = findColumn(rows, [
      "Animal group", "Taxonomic group",
      "Animal class", "Taxonomic class",
      "Class", "group", "Taxa group",
      "Taxon group", "Taxa"
    ]);

    const outcomeCol = findColumn(rows, [
      "Reported outcome", "Release outcome",
      "Outcome", "Translocation success",
      "Success status", "Success", "Result"
    ]);

    const countryCol = findColumn(rows, [
      "transl.country", "Release country",
      "Country of release", "Translocation country",
      "Country of translocation",
      "Country", "Location country"
    ]);

    if (
      !groupCol ||
      !outcomeCol ||
      !countryCol
    ) {
      throw new Error(
        "Cannot identify release CSV columns: " +
        Object.keys(rows[0]).join(", ")
      );
    }

    const australian = rows.filter(row =>
      /\baustralia\b/i.test(
        String(row[countryCol] ?? "")
      )
    );

    if (!australian.length) {
      throw new Error(
        "No Australian study records found"
      );
    }

    function canonicalGroup(value) {
      const text = String(value ?? "").trim();

      if (/mammal/i.test(text)) return "Mammals";
      if (/bird|aves|avian/i.test(text)) return "Birds";
      if (/reptil|amphib|herpet/i.test(text)) {
        return "Reptiles & amphibians";
      }
      if (/fish|fishes|actinopter/i.test(text)) {
        return "Fishes";
      }

      return text || "Other / unspecified";
    }

    function canonicalOutcome(value) {
      const text = String(value ?? "")
        .trim()
        .toLowerCase();

      if (
        !text ||
        /not reported|not stated|not available|^na$|^n\/a$/.test(text)
      ) {
        return "Not reported";
      }

      if (
        /undetermined|uncertain|unknown|inconclusive|mixed/.test(text)
      ) {
        return "Undetermined";
      }

      if (
        /unsuccess|failure|failed|^no$/.test(text)
      ) {
        return "Failure";
      }

      if (/success|^yes$/.test(text)) {
        return "Success";
      }

      return "Other / unclear";
    }

    const counts = new Map();

    for (const row of australian) {
      const group = canonicalGroup(row[groupCol]);
      const outcome = canonicalOutcome(
        row[outcomeCol]
      );
      const key = `${group}\u0000${outcome}`;

      counts.set(
        key,
        (counts.get(key) || 0) + 1
      );
    }

    const edges = [...counts].map(
      ([key, count]) => {
        const [group, outcome] =
          key.split("\u0000");
        return { group, outcome, count };
      }
    );

    const groupCount = group =>
      edges
        .filter(edge => edge.group === group)
        .reduce(
          (sum, edge) => sum + edge.count,
          0
        );

    const outcomeCount = outcome =>
      edges
        .filter(edge => edge.outcome === outcome)
        .reduce(
          (sum, edge) => sum + edge.count,
          0
        );

    const groups = [
      ...new Set(edges.map(edge => edge.group))
    ].sort(
      (a, b) => groupCount(b) - groupCount(a)
    );

    const outcomeOrder = [
      "Success",
      "Failure",
      "Undetermined",
      "Not reported",
      "Other / unclear"
    ];

    const outcomes = outcomeOrder.filter(
      outcome => edges.some(
        edge => edge.outcome === outcome
      )
    );

    const element =
      document.getElementById("vis-sankey");

    if (!element) {
      throw new Error(
        "Sankey container not found"
      );
    }

    const width = Math.min(
      880,
      Math.max(480, element.clientWidth - 34)
    );

    const height = 410;
    const padding = 22;
    const gap = 15;
    const nodeWidth = 16;
    const leftX = 160;
    const rightX = width - 160;

    const total = edges.reduce(
      (sum, edge) => sum + edge.count,
      0
    );

    const scale = Math.min(
      (
        height - 2 * padding -
        gap * Math.max(0, groups.length - 1)
      ) / total,
      (
        height - 2 * padding -
        gap * Math.max(0, outcomes.length - 1)
      ) / total
    );

    if (!(scale > 0)) {
      throw new Error(
        "Sankey categories do not fit"
      );
    }

    const colours = [
      "#183a30",
      "#55765b",
      "#789a80",
      "#bd6848",
      "#879b8a",
      "#a7b5a4"
    ];

    const groupColours = Object.fromEntries(
      groups.map((group, index) => [
        group,
        colours[index % colours.length]
      ])
    );

    const nodes = [];
    const groupMap = {};
    const outcomeMap = {};

    let y = padding;

    for (const group of groups) {
      const nodeHeight =
        groupCount(group) * scale;

      groupMap[group] = {
        y,
        next: y
      };

      nodes.push({
        label: group,
        count: groupCount(group),
        x: leftX,
        y,
        width: nodeWidth,
        height: nodeHeight,
        colour: groupColours[group],
        labelX: leftX - 9,
        labelY: y + nodeHeight / 2,
        align: "right"
      });

      y += nodeHeight + gap;
    }

    y = padding;

    for (const outcome of outcomes) {
      const nodeHeight =
        outcomeCount(outcome) * scale;

      outcomeMap[outcome] = {
        y,
        next: y
      };

      nodes.push({
        label: outcome,
        count: outcomeCount(outcome),
        x: rightX,
        y,
        width: nodeWidth,
        height: nodeHeight,
        colour: "#365d49",
        labelX: rightX + nodeWidth + 9,
        labelY: y + nodeHeight / 2,
        align: "left"
      });

      y += nodeHeight + gap;
    }

    const flows = [];

    for (const group of groups) {
      for (const outcome of outcomes) {
        const edge = edges.find(item =>
          item.group === group &&
          item.outcome === outcome
        );

        if (!edge) continue;

        const thickness =
          edge.count * scale;

        const startY =
          groupMap[group].next;

        const endY =
          outcomeMap[outcome].next;

        groupMap[group].next += thickness;
        outcomeMap[outcome].next += thickness;

        const x0 = leftX + nodeWidth;
        const x1 = rightX;

        const curveX0 =
          x0 + (x1 - x0) * 0.48;

        const curveX1 =
          x1 - (x1 - x0) * 0.48;

        const path =
          `M ${x0} ${startY} ` +
          `C ${curveX0} ${startY} ` +
          `${curveX1} ${endY} ` +
          `${x1} ${endY} ` +
          `L ${x1} ${endY + thickness} ` +
          `C ${curveX1} ${endY + thickness} ` +
          `${curveX0} ${startY + thickness} ` +
          `${x0} ${startY + thickness} Z`;

        flows.push({
          ...edge,
          path,
          colour: groupColours[group]
        });
      }
    }

    spec.width = width;
    spec.height = height;

    const flowDataset = spec.data.find(
      dataset => dataset.name === "flows"
    );

    const nodeDataset = spec.data.find(
      dataset => dataset.name === "nodes"
    );

    if (!flowDataset || !nodeDataset) {
      throw new Error(
        "Sankey requires flows and nodes datasets"
      );
    }

    flowDataset.values = flows;
    nodeDataset.values = nodes;

    await vegaEmbed(
      "#vis-sankey",
      spec,
      chartSettings
    );

    console.log(
      `Sankey loaded: ${australian.length} Australian records`
    );
  } catch (error) {
    reportError("vis-sankey", error);
  }
}

// ============================================
// FIGURE 10 — DOT-DENSITY HELPERS
// ============================================

function randomGenerator(seed) {
  let state = seed >>> 0;

  return () => {
    state =
      (1664525 * state + 1013904223) >>> 0;

    return state / 4294967296;
  };
}

function pointInRing(point, ring) {
  let inside = false;
  const [x, y] = point;

  for (
    let i = 0, j = ring.length - 1;
    i < ring.length;
    j = i++
  ) {
    const a = ring[i];
    const b = ring[j];

    if (
      ((a[1] > y) !== (b[1] > y)) &&
      x <
        (b[0] - a[0]) *
        (y - a[1]) /
        (b[1] - a[1]) +
        a[0]
    ) {
      inside = !inside;
    }
  }

  return inside;
}

function pointInPolygon(point, rings) {
  return (
    pointInRing(point, rings[0]) &&
    !rings.slice(1).some(
      hole => pointInRing(point, hole)
    )
  );
}

function geometryPolygons(geometry) {
  return geometry.type === "Polygon"
    ? [geometry.coordinates]
    : geometry.coordinates;
}

function randomPointInGeometry(
  geometry,
  random
) {
  const polygons = geometryPolygons(geometry);

  const candidates = polygons
    .map(rings => {
      const xs = rings[0].map(
        point => point[0]
      );
      const ys = rings[0].map(
        point => point[1]
      );

      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);

      return {
        rings,
        minX,
        maxX,
        minY,
        maxY,
        weight:
          (maxX - minX) * (maxY - minY)
      };
    })
    .filter(
      candidate => candidate.weight > 0
    );

  const total = candidates.reduce(
    (sum, candidate) =>
      sum + candidate.weight,
    0
  );

  for (
    let attempt = 0;
    attempt < 5000;
    attempt++
  ) {
    let pick = random() * total;

    let candidate =
      candidates[candidates.length - 1];

    for (const item of candidates) {
      pick -= item.weight;

      if (pick <= 0) {
        candidate = item;
        break;
      }
    }

    const x =
      candidate.minX +
      random() *
      (candidate.maxX - candidate.minX);

    const y =
      candidate.minY +
      random() *
      (candidate.maxY - candidate.minY);

    if (
      pointInPolygon(
        [x, y],
        candidate.rings
      )
    ) {
      return [x, y];
    }
  }

  throw new Error(
    "Could not sample inside a state polygon"
  );
}

// ============================================
// FIGURE 10 — DOT-DENSITY MAP
// ============================================

async function drawDotDensityMap() {
  try {
    const [rows, geojson, spec] =
      await Promise.all([
        loadCSV("data/threatened_animals.csv"),
        loadJSON("data/australia_states.geojson"),
        loadJSON("charts/threatened_dot_density.vl.json")
      ]);

    const features =
      prepareAustralianFeatures(geojson);

    assertEightStates(features);

    const dots = [];
    const taxaPerDot = 10;

    for (
      const [index, feature]
      of features.entries()
    ) {
      const state =
        feature.properties.STATE_NAME;

      const listedTaxa =
        countListedTaxa(
          rows,
          stateCodes[state]
        );

      const dotCount = Math.round(
        listedTaxa / taxaPerDot
      );

      const random = randomGenerator(
        1729 + index * 113
      );

      for (let i = 0; i < dotCount; i++) {
        const [longitude, latitude] =
          randomPointInGeometry(
            feature.geometry,
            random
          );

        dots.push({
          state,
          longitude,
          latitude,
          listed_taxa: listedTaxa,
          dot_count: dotCount
        });
      }
    }

    spec.layer[0].data = {
      values: features
    };

    spec.layer[1].data = {
      values: dots
    };

    await vegaEmbed(
      "#vis-dot-density",
      spec,
      chartSettings
    );

    console.log(
      `Dot-density map loaded: ${dots.length} schematic dots`
    );
  } catch (error) {
    reportError("vis-dot-density", error);
  }
}

// ============================================
// FIGURE 11 — LOLLIPOP CHART
// ============================================

async function drawLollipop() {
  try {
    const [rows, spec] = await Promise.all([
      loadCSV("data/threatened_animals.csv"),
      loadJSON("charts/critically_endangered_lollipop.vl.json")
    ]);

    const classCol = findColumn(
      rows,
      ["Class"]
    );

    const statusCol = findColumn(
      rows,
      ["Threatened status"]
    );

    if (!classCol || !statusCol) {
      throw new Error(
        "Missing Class or Threatened status column"
      );
    }

    const totals = new Map();
    const critical = new Map();

    for (const row of rows) {
      const group =
        String(row[classCol] ?? "").trim();

      const status =
        String(row[statusCol] ?? "").trim();

      if (!group) continue;

      totals.set(
        group,
        (totals.get(group) || 0) + 1
      );

      if (
        status.toLowerCase() ===
        "critically endangered"
      ) {
        critical.set(
          group,
          (critical.get(group) || 0) + 1
        );
      }
    }

    const values = [...critical.entries()]
      .map(([animal_class, count]) => ({
        animal_class,
        count,
        total: totals.get(animal_class),
        share:
          count / totals.get(animal_class)
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    if (!values.length) {
      throw new Error(
        "No Critically Endangered records found"
      );
    }

    spec.data = { values };

    await vegaEmbed(
      "#vis-lollipop",
      spec,
      chartSettings
    );

    console.log(
      "Lollipop loaded successfully"
    );
  } catch (error) {
    reportError("vis-lollipop", error);
  }
}

// ============================================
// FIGURE 12 — WAFFLE CHART
// ============================================

async function drawWaffle() {
  try {
    const [rows, spec] = await Promise.all([
      loadCSV("data/threatened_animals.csv"),
      loadJSON("charts/threat_status_waffle.vl.json")
    ]);

    const statusCol = findColumn(
      rows,
      ["Threatened status"]
    );

    if (!statusCol) {
      throw new Error(
        "Missing Threatened status column"
      );
    }

    const counts = new Map();

    for (const row of rows) {
      const status =
        String(row[statusCol] ?? "").trim();

      if (status) {
        counts.set(
          status,
          (counts.get(status) || 0) + 1
        );
      }
    }

    const order = [
      "Critically Endangered",
      "Endangered",
      "Vulnerable",
      "Extinct",
      "Extinct in the wild",
      "Conservation Dependent"
    ];

    const total = [...counts.values()]
      .reduce((a, b) => a + b, 0);

    if (!total) {
      throw new Error(
        "No valid threat status records"
      );
    }

    const parts = order
      .filter(status => counts.has(status))
      .map(status => {
        const exact =
          counts.get(status) / total * 100;

        return {
          status,
          count: counts.get(status),
          percentage: exact,
          tiles: Math.floor(exact),
          remainder: exact % 1
        };
      });

    let remaining =
      100 - parts.reduce(
        (sum, part) =>
          sum + part.tiles,
        0
      );

    const byRemainder = [...parts]
      .sort(
        (a, b) =>
          b.remainder - a.remainder
      );

    for (let i = 0; i < remaining; i++) {
      byRemainder[i].tiles++;
    }

    const tiles = [];
    let index = 0;

    for (const part of parts) {
      for (let n = 0; n < part.tiles; n++) {
        tiles.push({
          column: index % 10,
          row: 9 - Math.floor(index / 10),
          status: part.status,
          count: part.count,
          percentage: part.percentage
        });

        index++;
      }
    }

    spec.data = { values: tiles };

    await vegaEmbed(
      "#vis-waffle",
      spec,
      chartSettings
    );

    console.log(
      "Waffle loaded successfully"
    );
  } catch (error) {
    reportError("vis-waffle", error);
  }
}

// ============================================
// LOAD ALL 12 VISUALISATIONS
// ============================================

async function loadVisualisations() {
  await Promise.all([
    drawStateMap(),

    drawChart(
      "vis-status-heatmap",
      "charts/threatened_status_heatmap.vl.json"
    ),

    drawChart(
      "vis-treemap",
      "charts/threatened_animals_treemap.vg.json"
    ),

    drawChart(
      "vis-translocations",
      "charts/australian_releases.vl.json"
    ),

    drawChart(
      "vis-outcomes",
      "charts/release_outcomes.vl.json"
    ),

    drawChart(
      "vis-grants",
      "charts/conservation_grants.vl.json"
    ),

    drawWorldCartogram(),
    drawUpSetPlot(),
    drawReleaseSankey(),
    drawDotDensityMap(),
    drawLollipop(),
    drawWaffle()
  ]);
}

loadVisualisations();
