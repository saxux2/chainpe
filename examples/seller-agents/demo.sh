#!/usr/bin/env bash
#
# ChainPe — Full Demo Script
#
# Runs the complete agent-to-agent investment marketplace demo on Arbitrum Sepolia:
#   STEP 1  Fund seller wallets       (node fund-sellers.mjs)
#   STEP 2  Register agents on-chain  (node register-all.mjs)
#   STEP 3  Start all agents
#   STEP 4  Run the investment loop   (paper trades priced with real Arbitrum One quotes)
#
# Usage:
#   ./demo.sh              — full setup + run (first time)
#   ./demo.sh --run-only   — skip setup, just start agents + invest
#
# Prerequisites:
#   1. npm install && npm run build   (from the repo root)
#   2. npm install                    (here)
#   3. node gen-wallets.mjs           (paste the output into .env, add ANTHROPIC_API_KEY
#                                      and CHAINPE_REGISTRY_ADDRESS, fund the buyer)

set -euo pipefail
cd "$(dirname "$0")"

# ── Parse flags ───────────────────────────────────────────────────────────────

RUN_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --run-only) RUN_ONLY=1 ;;
  esac
done

# ── Load .env ─────────────────────────────────────────────────────────────────

if [ ! -f .env ]; then
  echo ""
  echo "  ✗  .env not found."
  echo "     Run:  node gen-wallets.mjs"
  echo "     Paste the output into .env, fund the buyer wallet, then re-run this script."
  exit 1
fi

set -a; . ./.env; set +a

# ── Validate required env vars ────────────────────────────────────────────────

MISSING=()
for var in \
  CHAINPE_PRIVATE_KEY \
  CHAINPE_REGISTRY_ADDRESS \
  RESEARCH_PAYTO RESEARCH_PAYTO_KEY \
  DIGEST_PAYTO   DIGEST_PAYTO_KEY \
  PRICE_PAYTO    PRICE_PAYTO_KEY \
  NEWS_PAYTO     NEWS_PAYTO_KEY \
  ANALYSIS_PAYTO ANALYSIS_PAYTO_KEY \
  DEX_PAYTO      DEX_PAYTO_KEY \
  ANTHROPIC_API_KEY; do
  if [ -z "${!var:-}" ]; then
    MISSING+=("$var")
  fi
done

if [ "${#MISSING[@]}" -gt 0 ]; then
  echo ""
  echo "  ✗  Missing required .env variables:"
  for v in "${MISSING[@]}"; do echo "       $v"; done
  echo ""
  echo "     Run:  node gen-wallets.mjs  to generate wallets,"
  echo "     then fill in ANTHROPIC_API_KEY + CHAINPE_REGISTRY_ADDRESS and re-run."
  exit 1
fi

# ── Banner ────────────────────────────────────────────────────────────────────

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  ChainPe — Agent-to-Agent Investment Demo"
echo "════════════════════════════════════════════════════════════════"
echo "  Mode:     🟡 PAPER TRADING (agent fees are real USDC payments)"
echo "  Network:  ${CHAINPE_NETWORK:-arbitrum-sepolia}"
echo "  Registry: ${CHAINPE_REGISTRY_ADDRESS}"
echo ""

# ── STEP 1 + 2 — Setup (skipped with --run-only) ─────────────────────────────

if [ "$RUN_ONLY" = "0" ]; then

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  STEP 1 — Funding seller wallets from the buyer wallet"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  node fund-sellers.mjs
  echo ""

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  STEP 2 — Registering all 6 agents on-chain"
  echo "  (mints an ERC-8004 identity + ChainPeRegistry entry per agent)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  node register-all.mjs
  echo ""

fi

# ── STEP 3 — Start all agents ─────────────────────────────────────────────────

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  STEP 3 — Starting all seller agents"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

RESEARCH_PROXY_PORT="${RESEARCH_PROXY_PORT:-4501}"
DIGEST_PROXY_PORT="${DIGEST_PROXY_PORT:-4502}"
PRICE_PROXY_PORT="${PRICE_PROXY_PORT:-4503}"
NEWS_PROXY_PORT="${NEWS_PROXY_PORT:-4504}"
ANALYSIS_PROXY_PORT="${ANALYSIS_PROXY_PORT:-4505}"
DEX_PROXY_PORT="${DEX_PROXY_PORT:-4506}"

pids=()
cleanup() {
  echo ""
  echo "Shutting down seller agents…"
  for pid in "${pids[@]:-}"; do kill "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT INT TERM

node research-agent.mjs          &  pids+=($!)
node news-digest-agent.mjs       &  pids+=($!)
node arbitrum-price-agent.mjs    &  pids+=($!)
node arbitrum-news-agent.mjs     &  pids+=($!)
node arbitrum-analysis-agent.mjs &  pids+=($!)
node arbitrum-dex-agent.mjs      &  pids+=($!)

echo ""
echo "  Waiting for all agents to become healthy…"

wait_healthy() {
  local url="$1" name="$2"
  for _ in $(seq 1 40); do
    if curl -fsS "$url/health" >/dev/null 2>&1; then
      echo "  ✓  $name"
      return 0
    fi
    sleep 1
  done
  echo "  ✗  $name did not start at $url" >&2
  return 1
}

wait_healthy "http://localhost:${RESEARCH_PROXY_PORT}"  "Research Agent          → :${RESEARCH_PROXY_PORT}/research"
wait_healthy "http://localhost:${DIGEST_PROXY_PORT}"    "News Digest Agent       → :${DIGEST_PROXY_PORT}/summarize"
wait_healthy "http://localhost:${PRICE_PROXY_PORT}"     "Arbitrum Price Agent    → :${PRICE_PROXY_PORT}/price"
wait_healthy "http://localhost:${NEWS_PROXY_PORT}"      "Arbitrum News Agent     → :${NEWS_PROXY_PORT}/news"
wait_healthy "http://localhost:${ANALYSIS_PROXY_PORT}"  "Arbitrum Analysis Agent → :${ANALYSIS_PROXY_PORT}/analyze"
wait_healthy "http://localhost:${DEX_PROXY_PORT}"       "Arbitrum DEX Agent      → :${DEX_PROXY_PORT}/quote"

# ── STEP 4 — Run the investment orchestrator ──────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  STEP 4 — Running investment orchestrator"
echo "  Buyer discovers agents → pays each in USDC → paper trade at a real quote"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

node investment-orchestrator.mjs --cycles "${INVEST_CYCLES:-1}"

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  Demo complete. Agents are still running."
echo "  Run again:   ./demo.sh --run-only"
echo "  More cycles: INVEST_CYCLES=3 ./demo.sh --run-only"
echo "════════════════════════════════════════════════════════════════"
echo ""

# Keep agents alive so the audience can hit endpoints manually
echo "  Press Ctrl+C to stop all agents."
wait
