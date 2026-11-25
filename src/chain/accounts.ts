import type { Address, Hex } from "viem";

/**
 * The six accounts of the in-browser chain. They are the first six of the widely published
 * Hardhat / Foundry development accounts: their private keys are public, so they exist only for
 * local testing. Never send real ETH or Sepolia ETH to them.
 *
 * The roles follow the build guide's table of test roles (section 4), plus a second donor and an
 * unrelated wallet for the rejection tests.
 */
export type DemoAccount = {
  index: number;
  address: Address;
  privateKey: Hex;
  role: string;
  /** A short name for tight spaces. */
  short: string;
};

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    index: 0,
    address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    role: "Organizer",
    short: "Organizer",
  },
  {
    index: 1,
    address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    role: "Food and water recipient",
    short: "Food and water",
  },
  {
    index: 2,
    address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    privateKey: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    role: "Shelter recipient",
    short: "Shelter",
  },
  {
    index: 3,
    address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    privateKey: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
    role: "Medical supplies recipient",
    short: "Medical supplies",
  },
  {
    index: 4,
    address: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
    privateKey: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
    role: "Second donor",
    short: "Second donor",
  },
  {
    index: 5,
    address: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
    privateKey: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
    role: "Unrelated wallet",
    short: "Unrelated",
  },
];

export function demoAccountFor(address: string | undefined | null): DemoAccount | undefined {
  if (!address) return undefined;
  const a = address.toLowerCase();
  return DEMO_ACCOUNTS.find((x) => x.address.toLowerCase() === a);
}
