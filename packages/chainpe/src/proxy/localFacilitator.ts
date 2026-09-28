/**
 * In-process x402 facilitator (optional).
 *
 * Instead of depending on an external facilitator service, the provider can
 * settle payments itself. The facilitator is used directly as the resource
 * server's FacilitatorClient (no HTTP round-trip), and can also be mounted as
 * a router exposing the standard x402 facilitator contract (`/verify`,
 * `/settle`, `/supported`).
 *
 * Settlement submits the payer's signed EIP-3009 `transferWithAuthorization` and
 * pays the ETH gas, so this requires a funded EVM key. The key only pays gas and
 * relays the payer's signature — it never receives the payment (that goes to the
 * provider's `payTo`).
 */
import express, { Router, type Request, type Response } from "express";
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Facilitator } from "@x402/core/facilitator";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements, SupportedResponse } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { getNetwork, type ChainPeNetwork } from "../chains.js";
import { logger } from "../logger.js";

function normalizeKey(key: string): `0x${string}` {
  return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
}

/** Builds an x402 facilitator that settles on `network` with the given gas key. */
export function createLocalFacilitator(privateKey: string, network: ChainPeNetwork): x402Facilitator {
  const info = getNetwork(network);
  const account = privateKeyToAccount(normalizeKey(privateKey));
  const client = createWalletClient({
    account,
    chain: info.chain,
    transport: http(info.rpcUrl),
  }).extend(publicActions);

  const signer = toFacilitatorEvmSigner({
    address: account.address,
    readContract: args => client.readContract(args as Parameters<typeof client.readContract>[0]),
    verifyTypedData: args =>
      client.verifyTypedData(args as Parameters<typeof client.verifyTypedData>[0]),
    writeContract: args =>
      client.writeContract(args as Parameters<typeof client.writeContract>[0]),
    sendTransaction: args => client.sendTransaction(args),
    waitForTransactionReceipt: args => client.waitForTransactionReceipt(args),
    getCode: args => client.getCode(args),
  });

  logger.info(`Local facilitator wallet: ${account.address} (pays ${info.nativeSymbol} gas on ${info.displayName})`);

  return new x402Facilitator().register(info.x402Network, new ExactEvmScheme(signer));
}

/** Adapts an in-process facilitator to the resource server's FacilitatorClient interface. */
export function toFacilitatorClient(facilitator: x402Facilitator): FacilitatorClient {
  return {
    verify: (payload: PaymentPayload, requirements: PaymentRequirements) =>
      facilitator.verify(payload, requirements),
    settle: (payload: PaymentPayload, requirements: PaymentRequirements) =>
      facilitator.settle(payload, requirements),
    getSupported: async () => facilitator.getSupported() as SupportedResponse,
  };
}

/** Exposes a facilitator over the standard x402 HTTP contract. */
export function createLocalFacilitatorRouter(privateKey: string, network: ChainPeNetwork): Router {
  const facilitator = createLocalFacilitator(privateKey, network);
  const info = getNetwork(network);

  const router = Router();
  router.use(express.json());

  router.get("/supported", (_req: Request, res: Response) => {
    res.json(facilitator.getSupported());
  });

  router.post("/verify", async (req: Request, res: Response) => {
    try {
      res.json(await facilitator.verify(req.body.paymentPayload, req.body.paymentRequirements));
    } catch (err) {
      res.status(400).json({
        isValid: false,
        invalidReason: `verify_error: ${(err as Error).message}`,
      });
    }
  });

  router.post("/settle", async (req: Request, res: Response) => {
    try {
      res.json(await facilitator.settle(req.body.paymentPayload, req.body.paymentRequirements));
    } catch (err) {
      logger.error(`[facilitator settle] ${(err as Error).stack ?? (err as Error).message}`);
      res.status(400).json({
        success: false,
        errorReason: "settle_error",
        transaction: "",
        network: info.x402Network,
        errorMessage: (err as Error).message,
      });
    }
  });

  return router;
}
