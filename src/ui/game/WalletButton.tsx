"use client";

import Image from "next/image";
import { useState } from "react";
import { useChain } from "@/onchain/ChainProvider";
import { shortenAddress } from "@/onchain/wallet/standard";
import { useGame } from "@/sim/store";
import { Button, Modal, cn } from "@/ui/primitives";
import { IconWallet } from "@/ui/icons";

/**
 * Wallet connection.
 *
 * Two things this deliberately makes obvious, because getting them wrong is
 * how crypto games lose people's trust:
 *
 *  1. Connecting is **read-only**. The dialog says so, because "connect
 *     wallet" has been trained to mean "about to be asked to sign something".
 *  2. The demo wallet is a first-class option, not a fallback. Most people
 *     trying a browser game should not have to install an extension.
 */

export function WalletButton() {
  const { wallet, wallets, connect, disconnect, simulated } = useChain();
  const [open, setOpen] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const pushToast = useGame((s) => s.pushToast);
  const resetGame = useGame((s) => s.reset);

  const connected = wallet.status === "connected" && wallet.address;

  async function onPick(name: string) {
    setConnecting(name);
    try {
      await connect(name);
      setOpen(false);
    } catch (error) {
      pushToast({
        kind: "error",
        title: "Couldn't connect",
        message: error instanceof Error ? error.message : "The wallet rejected the request",
      });
    } finally {
      setConnecting(null);
    }
  }

  if (connected) {
    return (
      <>
        <button
          onClick={() => setOpen(true)}
          className="vx-bevel flex h-9 items-center gap-2 border border-edge bg-crust px-2.5 transition-colors hover:border-edge-hi"
        >
          <span className="h-1.5 w-1.5 shrink-0 bg-good" />
          <span className="tnum hidden text-[11px] text-body sm:block">
            {shortenAddress(wallet.address!)}
          </span>
          <IconWallet size={14} className="text-mute sm:hidden" />
        </button>

        <Modal
          open={open}
          onClose={() => setOpen(false)}
          title="Connected"
          subtitle={wallet.walletName ?? undefined}
        >
          <div className="p-5">
            <div className="border border-edge bg-crust p-3">
              <div className="text-[10px] uppercase tracking-[0.13em] text-mute">Address</div>
              <div className="tnum mt-1 break-all text-xs text-body">{wallet.address}</div>
            </div>

            <p className="mt-4 text-xs leading-relaxed text-mute">
              This address seeds your claim&rsquo;s terrain, so the same ground comes back on any
              device. {simulated && "Nothing has been signed and no transaction has been sent."}
            </p>

            <div className="mt-5 flex gap-2">
              <Button
                variant="secondary"
                full
                onClick={async () => {
                  await disconnect();
                  resetGame();
                  setOpen(false);
                }}
              >
                Disconnect
              </Button>
            </div>
          </div>
        </Modal>
      </>
    );
  }

  return (
    <>
      <Button
        size="sm"
        variant="primary"
        icon={<IconWallet size={14} />}
        loading={wallet.status === "connecting"}
        onClick={() => setOpen(true)}
      >
        <span className="hidden sm:inline">Connect</span>
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Choose a wallet"
        subtitle="Read-only — your address seeds your claim. Nothing is ever signed."
      >
        <div className="p-5">
          <ul className="space-y-2">
            {wallets.map((entry) => {
              const isDemo = entry.name === "Demo Wallet";
              return (
                <li key={entry.name}>
                  <button
                    onClick={() => onPick(entry.name)}
                    disabled={connecting !== null}
                    className={cn(
                      "vx-bevel flex w-full items-center gap-3 border p-3 text-left transition-colors disabled:opacity-50",
                      isDemo
                        ? "border-amber/45 bg-amber/8 hover:border-amber/70"
                        : "border-edge bg-crust hover:border-edge-hi hover:bg-panel"
                    )}
                  >
                    <Image
                      src={entry.icon}
                      alt=""
                      width={28}
                      height={28}
                      unoptimized
                      className="h-7 w-7 shrink-0 border border-edge"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-display text-sm text-hi">{entry.name}</span>
                      <span className="block text-[11px] text-mute">
                        {isDemo
                          ? "No extension needed — start playing immediately"
                          : "Detected in this browser"}
                      </span>
                    </span>
                    {connecting === entry.name && (
                      <span className="text-[10px] uppercase tracking-wide text-amber">
                        Connecting
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          <p className="mt-5 border-t border-edge pt-4 text-[11px] leading-relaxed text-faint">
            STRATA has no token and requests no transactions. A connected wallet is used only to
            derive your claim seed and to label your inventory.
          </p>
        </div>
      </Modal>
    </>
  );
}
