"use strict";

const HTTP_METHODS_WITH_CONFIG = ["delete", "get", "head", "options"];
const HTTP_METHODS_WITH_DATA = ["post", "postForm", "put", "putForm", "patch", "patchForm"];

function boundedTimeout(config, maximumTimeoutMs) {
  if (!Number.isFinite(maximumTimeoutMs) || maximumTimeoutMs <= 0) return config;
  const next = config && typeof config === "object" && !Array.isArray(config)
    ? { ...config }
    : {};
  const requested = Number(next.timeout);
  next.timeout = Number.isFinite(requested) && requested > 0
    ? Math.min(Math.floor(requested), maximumTimeoutMs)
    : maximumTimeoutMs;
  return next;
}

function createBoundedAxios(axios, maximumTimeoutMs = null) {
  const maxTimeout = Number.isFinite(Number(maximumTimeoutMs)) && Number(maximumTimeoutMs) > 0
    ? Math.floor(Number(maximumTimeoutMs))
    : null;
  const client = {
    constructor: axios.constructor.bind(axios),
    request: (config) => axios.request(boundedTimeout(config, maxTimeout)),
    _request: (configOrUrl, config) => typeof configOrUrl === "string"
      ? axios._request(configOrUrl, boundedTimeout(config, maxTimeout))
      : axios._request(boundedTimeout(configOrUrl, maxTimeout)),
    getUri: axios.getUri.bind(axios),
    create: (config) => createBoundedAxios(axios.create(boundedTimeout(config, maxTimeout)), maxTimeout),
    isCancel: axios.isCancel.bind(axios),
    toFormData: axios.toFormData.bind(axios),
    all: axios.all.bind(axios),
    spread: axios.spread.bind(axios),
    isAxiosError: axios.isAxiosError.bind(axios),
    mergeConfig: axios.mergeConfig.bind(axios),

    defaults: axios.defaults,
    interceptors: axios.interceptors,
    Axios: axios.Axios,
    CanceledError: axios.CanceledError,
    CancelToken: axios.CancelToken,
    VERSION: axios.VERSION,
    AxiosError: axios.AxiosError,
    Cancel: axios.Cancel,
    AxiosHeaders: axios.AxiosHeaders,
    formToJSON: axios.formToJSON,
    getAdapter: axios.getAdapter,
    HttpStatusCode: axios.HttpStatusCode,
  };

  for (const method of HTTP_METHODS_WITH_CONFIG) {
    client[method] = (url, config) => axios[method](url, boundedTimeout(config, maxTimeout));
  }
  for (const method of HTTP_METHODS_WITH_DATA) {
    client[method] = (url, data, config) => axios[method](url, data, boundedTimeout(config, maxTimeout));
  }
  return client;
}

module.exports = { boundedTimeout, createBoundedAxios };
