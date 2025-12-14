#!/usr/bin/env bun

/**
 * Experiment to test if the macro works in development mode
 */

import { data } from "../src/provider/models-macro" with { type: "macro" }

console.log("Testing macro...")
const result = await data()
console.log("Macro result length:", result.length)
console.log("First 200 chars:", result.substring(0, 200))
