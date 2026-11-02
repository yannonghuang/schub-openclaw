#!/bin/sh
# Entry point for the material workflow's deterministic steps — see mat.mjs.
exec node "$(dirname "$0")/mat.mjs" "$@"
