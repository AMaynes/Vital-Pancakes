/**
 * Retains the adapter factory for compatibility while Knowledge Center is WIP.
 * No data is read and no operational commands are advertised.
 */
export function createHomeKnowledgeAiConfiguration() {
  return {
    id: "knowledge-home",
    title: "Knowledge Center (WIP)",
    description: "Planned knowledge and vault features awaiting verification.",
    limitations: ["WIP: knowledge and vault operations are currently unavailable."],
    getSnapshot: () => ({ status: "WIP", available: false }),
    getContext: () => ({ status: "WIP", available: false }),
    commitSnapshot: () => { throw new Error("Knowledge Center is WIP."); },
    commands: [],
  };
}
