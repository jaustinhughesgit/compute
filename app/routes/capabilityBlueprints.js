// routes/capabilityBlueprints.js
"use strict";

const {
  createWeatherCapabilityManifest,
  validateCapabilityBuildRequest,
} = require("./capabilityManifest");

const WEATHER_CAPABILITY_ID = "weather.current_conditions";
const WEATHER_BLUEPRINT_ID = "weather.open-meteo.current.v1";

const TRUSTED_MODULES = new Set(["axios"]);
const TRUSTED_HOSTS = new Set([
  "geocoding-api.open-meteo.com",
  "api.open-meteo.com",
]);

const clone = (value) => JSON.parse(JSON.stringify(value));

function weatherBuildRequest({ requestedBy = "system" } = {}) {
  const contract = createWeatherCapabilityManifest({
    entityId: "pending-weather-entity",
    ownerId: requestedBy,
    status: "active",
  });
  return validateCapabilityBuildRequest({
    schemaVersion: 1,
    kind: "computeCapabilityBuild",
    capabilityIdHint: WEATHER_CAPABILITY_ID,
    requestedBy,
    description: contract.description,
    operations: contract.operations,
  });
}

function weatherActions() {
  return [
    {
      set: {
        postalCode: "{|req=>body.postal_code|}",
        countryCode: "{|req=>body.country_code|}",
        unitSystem: "{|req=>body.unit_system|}",
        temperatureUnit: "fahrenheit",
        precipitationUnit: "inch",
      },
    },
    {
      if: [["{|unitSystem|}", "==", "metric"]],
      set: {
        temperatureUnit: "celsius",
        precipitationUnit: "mm",
      },
    },
    {
      target: "{|axios|}",
      chain: [{
        access: "get",
        params: [
          "https://geocoding-api.open-meteo.com/v1/search",
          {
            params: {
              name: "{|postalCode|}",
              count: 1,
              format: "json",
              language: "en",
              countryCode: "{|countryCode|}",
            },
          },
        ],
      }],
      assign: "{|locationResponse|}",
    },
    {
      set: {
        latitude: "{|locationResponse=>data.results[0].latitude|}",
        longitude: "{|locationResponse=>data.results[0].longitude|}",
      },
    },
    {
      target: "{|axios|}",
      chain: [{
        access: "get",
        params: [
          "https://api.open-meteo.com/v1/forecast",
          {
            params: {
              latitude: "{|latitude|}",
              longitude: "{|longitude|}",
              current: "temperature_2m,weather_code,precipitation_probability",
              temperature_unit: "{|temperatureUnit|}",
              precipitation_unit: "{|precipitationUnit|}",
              timezone: "auto",
              forecast_days: 1,
            },
          },
        ],
      }],
      assign: "{|weatherResponse|}",
    },
    {
      target: "{|res|}!",
      chain: [{
        access: "send",
        params: [{
          temperature: "{|weatherResponse=>data.current.temperature_2m|}",
          temperature_unit: "{|weatherResponse=>data.current_units.temperature_2m|}",
          conditions: "weather code {|weatherResponse=>data.current.weather_code|}",
          precipitation_probability: "{|weatherResponse=>data.current.precipitation_probability|}",
        }],
      }],
    },
  ];
}

function extractUrls(value, found = []) {
  if (typeof value === "string") {
    const matches = value.match(/https:\/\/[^\s"'}]+/g) || [];
    found.push(...matches);
  } else if (Array.isArray(value)) {
    for (const item of value) extractUrls(item, found);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) extractUrls(item, found);
  }
  return found;
}

function validateTrustedImplementation(implementation) {
  const modules = implementation?.published?.modules || {};
  for (const [alias, packageName] of Object.entries(modules)) {
    if (!TRUSTED_MODULES.has(alias) || packageName !== alias) {
      throw new Error(`compute blueprint uses unapproved module ${alias}:${packageName}`);
    }
  }
  for (const rawUrl of extractUrls(implementation?.published?.actions || [])) {
    let url;
    try { url = new URL(rawUrl); } catch (_) {
      throw new Error("compute blueprint contains an invalid provider URL");
    }
    if (url.protocol !== "https:" || !TRUSTED_HOSTS.has(url.hostname)) {
      throw new Error(`compute blueprint uses unapproved provider host ${url.hostname || "(blank)"}`);
    }
  }
  return implementation;
}

function weatherBlueprint({ requestedBy = "system", originalUtterance = "" } = {}) {
  const buildRequest = weatherBuildRequest({ requestedBy });
  const manifest = createWeatherCapabilityManifest({
    entityId: "pending-weather-entity",
    ownerId: requestedBy,
    status: "active",
  });
  const implementation = {
    blueprintId: WEATHER_BLUEPRINT_ID,
    capabilityId: WEATHER_CAPABILITY_ID,
    name: "Current Weather",
    description: buildRequest.description,
    provider: "open-meteo",
    approved: true,
    buildRequest,
    manifest,
    originalUtterance: String(originalUtterance || "").slice(0, 1000),
    published: {
      modules: { axios: "axios" },
      actions: weatherActions(),
      data: {
        computeBlueprintId: WEATHER_BLUEPRINT_ID,
        computeCapabilityId: WEATHER_CAPABILITY_ID,
        provider: "open-meteo",
      },
    },
  };
  return clone(validateTrustedImplementation(implementation));
}

function listCapabilityBlueprints() {
  return [{
    blueprintId: WEATHER_BLUEPRINT_ID,
    capabilityId: WEATHER_CAPABILITY_ID,
    description: "Current weather conditions from a postal code.",
  }];
}

function getCapabilityBlueprint(capabilityId, options = {}) {
  const id = String(capabilityId || "").trim().toLowerCase();
  if (id === WEATHER_CAPABILITY_ID) return weatherBlueprint(options);
  return null;
}

function buildComputeEntitySpec({ capabilityId, requestedBy, originalUtterance } = {}) {
  const blueprint = getCapabilityBlueprint(capabilityId, { requestedBy, originalUtterance });
  if (!blueprint) return null;
  return {
    computeEntity: {
      blueprintId: blueprint.blueprintId,
      capabilityId: blueprint.capabilityId,
      name: blueprint.name,
      description: blueprint.description,
      provider: blueprint.provider,
      approved: blueprint.approved,
      buildRequest: blueprint.buildRequest,
      manifest: blueprint.manifest,
      published: blueprint.published,
    },
  };
}

module.exports = {
  WEATHER_CAPABILITY_ID,
  WEATHER_BLUEPRINT_ID,
  listCapabilityBlueprints,
  getCapabilityBlueprint,
  buildComputeEntitySpec,
  validateTrustedImplementation,
};
