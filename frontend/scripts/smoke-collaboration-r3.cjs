#!/usr/bin/env node
/**
 * StudyKit v0.4 — WP-08 Round 3 real-browser smoke
 * (R3 variant: /tmp screenshots, all other behaviour
 * byte-for-byte the same as smoke-collaboration.cjs).
 *
 * The R2 smoke is the canonical one. This R3 variant
 * exists only to work around a OneDrive FS lock on
 * the original file at the time of the R3 submission;
 * it is byte-for-byte equivalent except for the
 * screenshot output path.
 */
process.env.SMOKE_VARIANT = "r3";
require("./smoke-collaboration.cjs");
