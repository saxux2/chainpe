---
id: troubleshooting-overview
title: Troubleshooting Overview
sidebar_position: 1
---

# Troubleshooting

Quick links to common issues:

- [Common Issues](./common-issues.md) — common problems with solutions
- [FAQ](../faq.md) — frequently asked questions

## Getting help

- **GitHub Issues:** [github.com/saxux2/chainpe/issues](https://github.com/saxux2/chainpe/issues)
- **Discord:** [discord.gg/chainpe](https://discord.gg/chainpe)

## Quick diagnostic checklist

Before filing an issue, run through:

1. Is your `CHAINPE_PRIVATE_KEY` valid? Check with `chainpe status`.
2. Do you have USDC on the right network? Testnet: [faucet.circle.com](https://faucet.circle.com) (Arbitrum Sepolia). Mainnet: native USDC on Arbitrum One.
3. Does the network match? Client and provider must both use `arbitrum` or both `arbitrum-sepolia`.
4. Is the provider's facilitator reachable? Run the proxy with `chainpe start -v`.
5. If you use an indexer, is it up and synced? `curl https://<your-indexer>/health`
6. Is the registry address set for registry discovery? `CHAINPE_REGISTRY_ADDRESS` (see `docs/DEPLOYMENTS.md`)
