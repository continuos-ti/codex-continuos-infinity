"use strict";

// Public product identity. Keep installation and update naming in one place.
// The original MIT copyright remains in LICENSE.
const PRODUCT_NAME = "Codex Continuos Infinity";
const REPOSITORY = "continuos-ti/codex-continuos-infinity";
const ARTIFACT_PREFIX = "codex-continuos-infinity";
const APP_ID = "br.com.continuos.codexinfinity.launcher";
const PRODUCTION_BROWSER_PARTITION = "persist:codex-continuos-infinity-chatgpt";
const DEVELOPMENT_BROWSER_PARTITION = "persist:codex-continuos-infinity-dev-chatgpt";

module.exports = {
  PRODUCT_NAME,
  REPOSITORY,
  ARTIFACT_PREFIX,
  APP_ID,
  PRODUCTION_BROWSER_PARTITION,
  DEVELOPMENT_BROWSER_PARTITION,
};