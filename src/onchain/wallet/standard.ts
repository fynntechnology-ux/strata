import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";

/**
 * Wallet discovery via the Wallet Standard.
 *
 * We talk to the standard directly instead of using `@solana/wallet-adapter-react`.
 * That package works, but it depends on `@solana-mobile/wallet-adapter-mobile`,
 * which pulls the entire React Native + Metro toolchain into a web build — 200+
 * packages, 15 npm advisories, and none of it ever reaches the browser bundle.
 *
 * The part we actually needed was about eighty lines, so here it is. Phantom,
 * Solflare, Backpack and every other modern Solana wallet register themselves
 * through this interface, so discovery works without naming a single wallet.
 */

const SOLANA_CHAIN_PREFIX = "solana:";

export interface DiscoveredWallet {
  name: string;
  /** data: URI supplied by the wallet itself. */
  icon: string;
  wallet: Wallet;
}

interface ConnectFeature {
  connect: (input?: { silent?: boolean }) => Promise<{ accounts: readonly WalletAccount[] }>;
}

interface DisconnectFeature {
  disconnect: () => Promise<void>;
}

interface EventsFeature {
  on: (event: "change", listener: (props: { accounts?: readonly WalletAccount[] }) => void) => () => void;
}

function supportsSolana(wallet: Wallet): boolean {
  return wallet.chains.some((chain) => chain.startsWith(SOLANA_CHAIN_PREFIX));
}

/** Every registered wallet that speaks Solana. Safe to call during render. */
export function discoverWallets(): DiscoveredWallet[] {
  if (typeof window === "undefined") return [];

  try {
    const { get } = getWallets();
    return get()
      .filter(supportsSolana)
      .filter((w) => "standard:connect" in w.features)
      .map((wallet) => ({
        name: wallet.name,
        icon: wallet.icon,
        wallet,
      }));
  } catch {
    // A malformed extension shouldn't take down the page.
    return [];
  }
}

/**
 * Subscribes to wallets registering after page load.
 *
 * Extensions inject asynchronously, so a wallet list read during first render
 * is frequently empty even when Phantom is installed. Without this the UI
 * would tell users they have no wallet a half-second before they do.
 */
export function onWalletsChanged(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  try {
    const { on } = getWallets();
    const offRegister = on("register", listener);
    const offUnregister = on("unregister", listener);
    return () => {
      offRegister();
      offUnregister();
    };
  } catch {
    return () => {};
  }
}

export async function connectWallet(
  wallet: Wallet,
  options: { silent?: boolean } = {}
): Promise<string | null> {
  const feature = wallet.features["standard:connect"] as ConnectFeature | undefined;
  if (!feature) return null;

  const { accounts } = await feature.connect(options.silent ? { silent: true } : undefined);
  const solanaAccount = accounts.find((a) => a.chains.some((c) => c.startsWith(SOLANA_CHAIN_PREFIX)));
  return solanaAccount?.address ?? accounts[0]?.address ?? null;
}

export async function disconnectWallet(wallet: Wallet): Promise<void> {
  const feature = wallet.features["standard:disconnect"] as DisconnectFeature | undefined;
  await feature?.disconnect();
}

/** Fires when the user switches accounts inside their wallet. */
export function onAccountChanged(
  wallet: Wallet,
  listener: (address: string | null) => void
): () => void {
  const feature = wallet.features["standard:events"] as EventsFeature | undefined;
  if (!feature) return () => {};

  return feature.on("change", ({ accounts }) => {
    if (!accounts) return;
    listener(accounts[0]?.address ?? null);
  });
}

/** `7xKq…9Fm2` — the standard way addresses are shown in Solana UIs. */
export function shortenAddress(address: string, lead = 4, tail = 4): string {
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}
