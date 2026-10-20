const csvFiles = [
  "data/threatened_species_states.csv",
  "data/zoo_translocations.csv"
];

async function checkCsvFiles() {
  for (const path of csvFiles) {
    const response = await fetch(path);

    if (!response.ok) {
      throw new Error(`Could not load ${path}: ${response.status}`);
    }

    const text = await response.text();
    const header = text.split(/\r?\n/, 1)[0];

    console.log(`Loaded ${path}`);
    console.log(`CSV header: ${header}`);
  }
}

checkCsvFiles().catch(error => console.error(error));