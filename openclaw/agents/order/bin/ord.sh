#!/bin/sh
# Entry point for the order workflow's deterministic steps — see ord.mjs.
exec node "$(dirname "$0")/ord.mjs" "$@"
