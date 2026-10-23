// Standalone Office has no connection to any shop or business database.
function availableShops() { return []; }
async function buildContext() { return {}; }
function needsBusinessData() { return false; }
module.exports = { availableShops, buildContext, needsBusinessData };
