#!/usr/bin/env bash
#
# Launch the agent-to-agent marketplace demo:
#   1. starts the LLM seller agents (each = backend + ChainPe x402 proxy)
#   2. waits for them to be healthy
#   3. (REGISTER=1) registers each on-chain with its ERC-8004 agentId
#   4. (ORCHESTRATE=1) runs the buyer orchestrator that hires + pays both
#      (INVEST=1) runs the investment orchestrator instead (paper trading)
#
# Prereqs: build the workspace packages once from the repo root
#   (npm install && npm run build), then `npm install` here, and fill in .env.
#   REGISTER=1 needs CHAINPE_REGISTRY_ADDRESS and funded seller wallets
#   (node fund-sellers.mjs). Identities are minted automatically.
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] && set -a && . ./.env && set +a

RESEARCH_PROXY_PORT="${RESEARCH_PROXY_PORT:-4501}"
DIGEST_PROXY_PORT="${DIGEST_PROXY_PORT:-4502}"
PRICE_PROXY_PORT="${PRICE_PROXY_PORT:-4503}"
NEWS_PROXY_PORT="${NEWS_PROXY_PORT:-4504}"
ANALYSIS_PROXY_PORT="${ANALYSIS_PROXY_PORT:-4505}"
DEX_PROXY_PORT="${DEX_PROXY_PORT:-4506}"

INVEST_ON=0
if [ "${INVEST:-0}" = "1" ] || [ "${INVEST_AGENTS:-0}" = "1" ]; then INVEST_ON=1; fi

pids=()
cleanup() {
  echo ""
  echo "Shutting down seller agents…"
  for pid in "${pids[@]:-}"; do kill "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT INT TERM

wait_healthy() {
  local url="$1" name="$2"
  for _ in $(seq 1 30); do
    if curl -fsS "$url/health" >/dev/null 2>&1; then echo "  ✓ $name healthy"; return 0; fi
    sleep 1
  done
  echo "  ✗ $name did not become healthy at $url" >&2
  return 1
}

echo "Starting seller agents on ${CHAINPE_NETWORK:-arbitrum-sepolia}…"
node research-agent.mjs &
pids+=($!)
node news-digest-agent.mjs &
pids+=($!)

if [ "$INVEST_ON" = "1" ]; then
  node arbitrum-price-agent.mjs &
  pids+=($!)
  node arbitrum-news-agent.mjs &
  pids+=($!)
  node arbitrum-analysis-agent.mjs &
  pids+=($!)
  node arbitrum-dex-agent.mjs &
  pids+=($!)
fi

wait_healthy "http://localhost:${RESEARCH_PROXY_PORT}" "research-agent"
wait_healthy "http://localhost:${DIGEST_PROXY_PORT}" "news-digest-agent"
if [ "$INVEST_ON" = "1" ]; then
  wait_healthy "http://localhost:${PRICE_PROXY_PORT}"    "arbitrum-price-agent"
  wait_healthy "http://localhost:${NEWS_PROXY_PORT}"     "arbitrum-news-agent"
  wait_healthy "http://localhost:${ANALYSIS_PROXY_PORT}" "arbitrum-analysis-agent"
  wait_healthy "http://localhost:${DEX_PROXY_PORT}"      "arbitrum-dex-agent"
fi

if [ "${REGISTER:-0}" = "1" ]; then
  echo ""
  echo "Registering sellers on-chain…"
  if [ "$INVEST_ON" = "1" ]; then
    # All six agents, each with its own ERC-8004 identity.
    node register-all.mjs
  else
    SELLER_KEY="${RESEARCH_PAYTO_KEY:?set RESEARCH_PAYTO_KEY to register}" \
    SELLER_NAME="${RESEARCH_NAME:-Research Agent}" \
    SELLER_ENDPOINT="${RESEARCH_PUBLIC_URL:-http://localhost:${RESEARCH_PROXY_PORT}}" \
    SELLER_PAYTO="${RESEARCH_PAYTO}" SELLER_TAGS="ai,research,agent" \
    SELLER_PRICE="${RESEARCH_PRICE:-0.01}" \
      node register-seller.mjs

    SELLER_KEY="${DIGEST_PAYTO_KEY:?set DIGEST_PAYTO_KEY to register}" \
    SELLER_NAME="${DIGEST_NAME:-News Digest Agent}" \
    SELLER_ENDPOINT="${DIGEST_PUBLIC_URL:-http://localhost:${DIGEST_PROXY_PORT}}" \
    SELLER_PAYTO="${DIGEST_PAYTO}" SELLER_TAGS="ai,news,summarize,agent" \
    SELLER_PRICE="${DIGEST_PRICE:-0.01}" \
      node register-seller.mjs
  fi
fi

echo ""
echo "Sellers are live:"
echo "  research → http://localhost:${RESEARCH_PROXY_PORT}/research"
echo "  digest   → http://localhost:${DIGEST_PROXY_PORT}/summarize"
if [ "$INVEST_ON" = "1" ]; then
  echo "  price    → http://localhost:${PRICE_PROXY_PORT}/price"
  echo "  news     → http://localhost:${NEWS_PROXY_PORT}/news"
  echo "  analysis → http://localhost:${ANALYSIS_PROXY_PORT}/analyze"
  echo "  dex      → http://localhost:${DEX_PROXY_PORT}/quote"
fi

if [ "${ORCHESTRATE:-0}" = "1" ]; then
  echo ""
  echo "Running buyer orchestrator…"
  node orchestrator.mjs "${TOPIC:-On-chain agent payments on Arbitrum in 2026}"
elif [ "${INVEST:-0}" = "1" ]; then
  echo ""
  echo "Running investment orchestrator (paper trading)…"
  node investment-orchestrator.mjs --cycles "${INVEST_CYCLES:-1}"
else
  echo ""
  echo "Run a buyer (in another shell):"
  echo "  npm run orchestrate -- \"your topic\"      # research + digest demo"
  echo "  npm run invest                            # ETH/USDC paper-trading loop"
  echo "Press Ctrl+C to stop the sellers."
  wait
fi
