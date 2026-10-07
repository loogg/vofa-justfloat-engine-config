(() => {
  "use strict";
  // Runtime adapters expose the same restricted contract. The development
  // bridge adapter is injected only by the Browser Review server.
  const transport = window.engineApi || window.browserReviewApi;
  window.backendApi = transport ? Object.freeze(transport) : null;
})();
