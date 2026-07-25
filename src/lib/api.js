// Single facade the UI uses for all backend calls. Swap the adapter here to go
// from the mock (this build) to a real HTTP backend later - nothing else changes.

import * as mock from "./mockAdapter.js";
import * as http from "./httpAdapter.js";

// Live backend by default (backend/ must be running on http://localhost:3000).
// Flip to true to demo the extension standalone with the in-panel mock.
const USE_MOCK = false;
const adapter = USE_MOCK ? mock : http;

export const getMasterProfile = (...a) => adapter.getMasterProfile(...a);
export const saveMasterProfile = (...a) => adapter.saveMasterProfile(...a);
export const updateMasterProfile = (...a) => adapter.updateMasterProfile(...a);
export const extractJd = (...a) => adapter.extractJd(...a);
export const generateResume = (...a) => adapter.generateResume(...a);
export const approveResume = (...a) => adapter.approveResume(...a);
export const searchResumes = (...a) => adapter.searchResumes(...a);
