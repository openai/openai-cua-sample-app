import catalog from "../../../../labs/catalog.json" with { type: "json" };

export const labCatalog = catalog;
export function getLabDefinition(labId: string) {
  const definition = catalog.scenarios.find(scenario => scenario.labId === labId);
  if (!definition) throw new Error(`Unknown lab: ${labId}`);
  return definition;
}
export const getLabInstructions = (labId: string): string[] => [...getLabDefinition(labId).instructions];
