#!/usr/bin/env node
// A rerun may adopt a prior release's metadata, but never new source/dependencies.
import { syncReleaseCheckout } from './release-safety.mjs';

syncReleaseCheckout();
