// Single facade the UI uses for all backend calls. Swap the adapter here to go
// from the mock (demo mode) to the real HTTP backend - nothing else changes.

import * as mock from "./mockAdapter.js";
import * as http from "./httpAdapter.js";

// Live backend by default (backend/ must be running on http://localhost:3000).
// Flip to true to demo the extension standalone with the in-panel mock.
const USE_MOCK = false;
const adapter = USE_MOCK ? mock : http;

// auth
export const login = (...a) => adapter.login(...a);
export const signup = (...a) => adapter.signup(...a);

// master profile
export const getMasterProfile = (...a) => adapter.getMasterProfile(...a);
export const saveMasterProfile = (...a) => adapter.saveMasterProfile(...a);
export const updateMasterProfile = (...a) => adapter.updateMasterProfile(...a);

// matching - flexible effort: analyse, then quick review or full tailor
export const extractJd = (...a) => adapter.extractJd(...a);
export const getRubric = (...a) => adapter.getRubric(...a);
export const reviewResume = (...a) => adapter.reviewResume(...a);
export const generateResume = (...a) => adapter.generateResume(...a);
export const approveResume = (...a) => adapter.approveResume(...a);
export const interviewPrep = (...a) => adapter.interviewPrep(...a);
export const searchResumes = (...a) => adapter.searchResumes(...a);

// application memory
export const overview = (...a) => adapter.overview(...a);
export const listApplications = (...a) => adapter.listApplications(...a);
export const createApplication = (...a) => adapter.createApplication(...a);
export const updateApplication = (...a) => adapter.updateApplication(...a);
