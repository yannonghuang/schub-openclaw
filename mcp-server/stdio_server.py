#!/usr/bin/env python3
"""
Stdio MCP server entrypoint.

Runs a single engine over stdio transport — suitable for local tool plugins
where the client (e.g. Claude Desktop, langchain-mcp-adapters) spawns this
process and communicates via stdin/stdout.

Usage:
    python stdio_server.py --engine supply_chain_engine

Supported engines: mytools, supply_chain_engine, mes_engine, order_engine, material_engine
"""

import argparse

from engines import ENGINES


def main() -> None:
    parser = argparse.ArgumentParser(description="Run an MCP engine over stdio transport")
    parser.add_argument(
        "--engine",
        default="mytools",
        choices=list(ENGINES),
        help="Which engine to serve (default: mytools)",
    )
    args = parser.parse_args()

    engine = ENGINES[args.engine]
    engine.run(transport="stdio")


if __name__ == "__main__":
    main()
