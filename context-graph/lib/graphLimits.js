/**
 * product_storage_locations is one row per (product, plant, sloc) — full table can be 10k+.
 * Graph UI should never pull all rows for many materials at once.
 */
export const OVERVIEW_MAX_PRODUCT_STORAGE_LOCS = 350;
export const NEIGHBOR_MAX_PRODUCT_STORAGE_LOCS = 500;
