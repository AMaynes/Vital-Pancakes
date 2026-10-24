/** File/sync actions share the AI protocol and require a one-action session grant. */
export function createDatabaseFilesAiAdapter({ getRevision, getSummary, grants, actions }) {
  const definitions = [
    ["package.download", "Download the complete database and attachments as a ZIP.", ["export", "file-access", "sensitive-data"]],
    ["package.save-folder", "Save the complete package into the user-selected local directory.", ["export", "file-access", "sensitive-data"]],
    ["package.import-folder", "Import the user-selected folder package, retaining a recovery copy first.", ["update", "delete", "file-access", "sensitive-data"]],
    ["drive.sync", "Sync only content selected for cloud storage, stopping on conflicts.", ["export", "update", "file-access", "sensitive-data"]],
    ["drive.remember", "Remember this browser connection; short-lived credentials may persist in this tab until expiry. Shared browser profiles share local data.", ["update", "sensitive-data"]],
    ["drive.auto-sync.enable", "Enable ongoing sync of current and future cloud-selected content while the site is open and Google authorization is valid. Requires an existing connection.", ["export", "update", "file-access", "sensitive-data"]],
    ["drive.auto-sync.disable", "Stop automatic sync in this browser.", ["update"]],
    ["drive.disconnect", "Disconnect Drive and stop automatic sync. Local data remains visible.", ["update", "sensitive-data"]],
    ["drive.forget", "Forget the connection and stop automatic sync. Keeps local data and its original account safety binding.", ["update", "sensitive-data"]],
    ["package.restore-recovery", "Restore the recovery copy explicitly selected by the user.", ["update", "delete", "sensitive-data"]],
  ];
  const commands = definitions.map(([type, description, permissions]) => ({ type, description, permissions, mutates: true,
    schema: { type: "object", properties: { type: { const: type } }, required: ["type"], additionalProperties: false }, example: { type } }));
  function validate(envelope) {
    if (envelope.commands.length !== 1) throw new Error("File and sync actions run individually so a batch cannot partially publish data.");
    const input = envelope.commands[0]; const definition = commands.find(item => item.type === input.type);
    if (!definition || Object.keys(input).some(key => key !== "type")) throw new Error("Unsupported file action or field.");
    if (!grants.has(input.type)) throw new Error("Grant this specific file action once in Storage & backup first. Folder selection and Google consent must already be completed by the user.");
    return input.type;
  }
  return { id: "database-files", title: "Database Files & Sync", getRevision,
    getCapabilities: () => ({ id: "database-files", title: "Database Files & Sync", commands, limitations: ["Requires a narrow one-action grant in Storage & backup. Enabling automatic sync authorizes ongoing transfer of cloud-selected content, not just one upload.", "Initial folder picker and Google consent/reconnection require human interaction.", "Tokens, account identity, files and database content are never returned by this adapter.", "Remembering does not extend Google's token expiry or isolate people sharing a browser profile.", "A sync conflict preserves both copies and requires an explicit resolution."] }),
    getContext: () => ({ ...getSummary(), allowedActions: [...grants] }),
    getRequiredPermissions: inputs => inputs.flatMap(input => { const command = commands.find(item => item.type === input.type); if (!command) throw new Error("Unsupported file action."); return command.permissions; }),
    async preview(envelope) { const type = validate(envelope); return { revision: getRevision(), result: { preview: true, action: type, ...getSummary() } }; },
    async apply(envelope) { const type = validate(envelope); const result = await actions[type](); grants.delete(type); return { revision: getRevision(), result: { action: type, completed: true, ...result } }; },
  };
}
