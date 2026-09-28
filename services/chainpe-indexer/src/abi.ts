/** Event ABIs watched by the indexer (registry services + ERC-8004 reputation). */

export const REGISTRY_EVENTS = [
  {
    type: 'event',
    name: 'ServiceRegistered',
    inputs: [
      { name: 'key', type: 'bytes32', indexed: true },
      { name: 'developer', type: 'address', indexed: true },
      { name: 'name', type: 'string', indexed: false },
      { name: 'endpoint', type: 'string', indexed: false },
      { name: 'pricePerRequest', type: 'string', indexed: false },
      { name: 'paymentToken', type: 'string', indexed: false },
      { name: 'payTo', type: 'address', indexed: false },
      { name: 'agentId', type: 'uint256', indexed: true }
    ]
  },
  {
    type: 'event',
    name: 'ServiceUpdated',
    inputs: [
      { name: 'key', type: 'bytes32', indexed: true },
      { name: 'developer', type: 'address', indexed: true },
      { name: 'name', type: 'string', indexed: false },
      { name: 'endpoint', type: 'string', indexed: false },
      { name: 'pricePerRequest', type: 'string', indexed: false },
      { name: 'paymentToken', type: 'string', indexed: false },
      { name: 'payTo', type: 'address', indexed: false },
      { name: 'agentId', type: 'uint256', indexed: true }
    ]
  },
  {
    type: 'event',
    name: 'ServiceDeregistered',
    inputs: [
      { name: 'key', type: 'bytes32', indexed: true },
      { name: 'developer', type: 'address', indexed: true },
      { name: 'name', type: 'string', indexed: false }
    ]
  }
] as const

/** Read-only `getService` view — used to enrich rows with description + tags
 * (which the events omit). */
const SERVICE_COMPONENTS = [
  { name: 'name', type: 'string' },
  { name: 'description', type: 'string' },
  { name: 'tags', type: 'string' },
  { name: 'endpoint', type: 'string' },
  { name: 'pricePerRequest', type: 'string' },
  { name: 'paymentToken', type: 'string' },
  { name: 'network', type: 'string' },
  { name: 'payTo', type: 'address' },
  { name: 'developer', type: 'address' },
  { name: 'agentId', type: 'uint256' },
  { name: 'createdAt', type: 'uint64' },
  { name: 'updatedAt', type: 'uint64' },
  { name: 'exists', type: 'bool' }
] as const

export const REGISTRY_READ_ABI = [
  {
    type: 'function',
    name: 'getService',
    stateMutability: 'view',
    inputs: [
      { name: 'developer', type: 'address' },
      { name: 'name', type: 'string' }
    ],
    outputs: [{ name: '', type: 'tuple', components: SERVICE_COMPONENTS }]
  }
] as const

export const REPUTATION_EVENTS = [
  {
    type: 'event',
    name: 'NewFeedback',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'clientAddress', type: 'address', indexed: true },
      { name: 'feedbackIndex', type: 'uint64', indexed: false },
      { name: 'value', type: 'int128', indexed: false },
      { name: 'valueDecimals', type: 'uint8', indexed: false },
      { name: 'indexedTag1', type: 'string', indexed: true },
      { name: 'tag1', type: 'string', indexed: false },
      { name: 'tag2', type: 'string', indexed: false },
      { name: 'endpoint', type: 'string', indexed: false },
      { name: 'feedbackURI', type: 'string', indexed: false },
      { name: 'feedbackHash', type: 'bytes32', indexed: false }
    ]
  },
  {
    type: 'event',
    name: 'FeedbackRevoked',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'clientAddress', type: 'address', indexed: true },
      { name: 'feedbackIndex', type: 'uint64', indexed: true }
    ]
  }
] as const
