/**
 * Service discovery for the agent, backed by the SDK: the ChainPe registry
 * (when configured), Coinbase's x402 Bazaar and ERC-8004 registration files.
 *
 * Services found by `discoverService` are remembered by name so that
 * `callPaidApi` can call them — Bazaar services aren't in any local file.
 */
import {
  discoverServices,
  findRegistryAddress,
  resolveIdentityRegistry,
  resolveReputationRegistry,
  type DiscoverOptions,
  type RankedService,
} from "@chainpe/sdk";
import type { ChainPeNetwork, ServiceInfo } from "./types.js";

export interface AgentDiscoveryOptions {
  network: ChainPeNetwork;
  /** ChainPeRegistry address; falls back to CHAINPE_REGISTRY_ADDRESS. Optional. */
  registryAddress?: string;
  reputationRegistry?: string;
}

export type DiscoveredService = ServiceInfo & { reputation: RankedService["reputation"] };

export class ServiceDiscovery {
  private readonly found = new Map<string, DiscoveredService>();

  constructor(private readonly options: AgentDiscoveryOptions) {}

  /** Searches every source and remembers the results by name. */
  async search(filters: Omit<DiscoverOptions, "sources"> = {}): Promise<DiscoveredService[]> {
    const { network, registryAddress, reputationRegistry } = this.options;
    const services = await discoverServices(network, filters, {
      registryAddress: findRegistryAddress(network, registryAddress),
      reputationRegistry: resolveReputationRegistry(network, reputationRegistry),
      identityRegistry: resolveIdentityRegistry(network),
    });
    for (const s of services) this.remember(s);
    return services;
  }

  /** A service found earlier in this run, by exact (case-insensitive) name. */
  lookup(name: string): DiscoveredService | undefined {
    return this.found.get(name.toLowerCase());
  }

  /** Finds a service by name: remembered results first, then a fresh search. */
  async findByName(name: string): Promise<DiscoveredService | undefined> {
    const known = this.lookup(name);
    if (known) return known;
    await this.search({ query: name });
    return this.lookup(name);
  }

  clear(): void {
    this.found.clear();
  }

  private remember(s: DiscoveredService): void {
    const key = s.name.toLowerCase();
    // The best-ranked service keeps the name.
    if (!this.found.has(key)) this.found.set(key, s);
  }
}
