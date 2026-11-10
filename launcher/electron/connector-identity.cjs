const CURRENT_CONNECTOR_NAME = "ContinuosWebIntegracao";
const DEV_CONNECTOR_NAME = `${CURRENT_CONNECTOR_NAME} DEV`;
function validateConnectorNameSuffix(value) {
  if (typeof value !== "string" || value.length > 74
    || !/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u.test(value)
    || value !== value.trim()) {
    throw new Error("The part after Codex must contain 1–74 letters, numbers, spaces, hyphens or underscores");
  }
  if (value === "Native") throw new Error("Codex Native is retired; choose another plugin name");
  return value;
}

function validateConnectorName(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 80) {
    throw new Error("Connector name is invalid");
  }
  return value.trim();
}

function isLegacyConnectorName(value) {
  // Recognize obsolete Native-series identifiers solely for migration, never use them.
  return /^Codex Native(?:2)?$/.test(value);
}
function connectorNameForSetup(value) {
  const configured=validateConnectorName(value);
  return isLegacyConnectorName(configured) ? CURRENT_CONNECTOR_NAME : configured;
}
function connectorNameForDevSetup(value) {
  if (value == null) return DEV_CONNECTOR_NAME;
  const configured=validateConnectorName(value);
  return configured === CURRENT_CONNECTOR_NAME || isLegacyConnectorName(configured)
    ? DEV_CONNECTOR_NAME : configured;
}
function requireCurrentRuntimeConnectorName(value) {
  const configured=validateConnectorName(value);
  if (isLegacyConnectorName(configured)) {
    throw new Error('The runtime connector identity is obsolete; apply the ContinuosWebIntegracao configuration and reconnect.');
  }
  return configured;
}

module.exports = {
  connectorNameForSetup,
  isLegacyConnectorName,
  connectorNameForDevSetup,
  CURRENT_CONNECTOR_NAME,
  DEV_CONNECTOR_NAME,
  requireCurrentRuntimeConnectorName,
  validateConnectorName,
  validateConnectorNameSuffix,
};
