import { config } from "dotenv";
import { CHAIN_ID, SOLANA_ACCOUNT_INDEX, UniversalAccount } from "@particle-network/universal-account-sdk";
import { getBytes, Wallet } from "ethers";
import WebSocket from "ws";

config();

const HEARTBEAT_INTERVAL = 5_000; // 5s
const DEFAULT_WSS_URL = "wss://universal-app-ws-proxy.particle.network";

interface WssTransactionUpdate {
    type: string;
    channel: string;
    userAddress: string;
    data: {
        transactionId: string;
        status: number; // 7 = success, 11 = failure
        sender: string;
    };
}

function setupHeartbeat(ws: WebSocket): NodeJS.Timeout {
    let alive = true;

    ws.on("pong", () => {
        alive = true;
    });

    const interval = setInterval(() => {
        if (!alive) {
            ws.terminate();
            return;
        }
        alive = false;
        if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
        }
    }, HEARTBEAT_INTERVAL);

    ws.on("close", () => {
        clearInterval(interval);
    });

    return interval;
}

function createWssConnection(
    wssUrl: string,
    addresses: string[],
): {
    waitForTransaction: (transactionId: string) => Promise<WssTransactionUpdate>;
    close: () => void;
} {
    const ws = new WebSocket(wssUrl);
    setupHeartbeat(ws);

    const pendingTransactions = new Map<
        string,
        {
            resolve: (value: WssTransactionUpdate) => void;
            reject: (reason: Error) => void;
        }
    >();

    const openPromise = new Promise<void>((resolve, reject) => {
        ws.on("open", () => {
            console.log("WebSocket connected, subscribing to address-update channel...");
            const subscribeMessage = {
                type: "subscribe",
                channel: "address-update",
                params: { addresses },
            };
            ws.send(JSON.stringify(subscribeMessage));
            resolve();
        });

        ws.on("error", (err) => {
            reject(err);
        });
    });

    ws.on("message", (data: WebSocket.Data) => {
        try {
            const message = JSON.parse(data.toString()) as WssTransactionUpdate;
            if (
                message.type === "transaction_update" &&
                message.channel === "address-update" &&
                message.data?.transactionId
            ) {
                const pending = pendingTransactions.get(message.data.transactionId);
                if (pending && (message.data.status === 7 || message.data.status === 11)) {
                    pendingTransactions.delete(message.data.transactionId);
                    pending.resolve(message);
                }
            }
        } catch (e) {
            // Ignore parse errors
        }
    });

    ws.on("close", () => {
        for (const [, pending] of pendingTransactions) {
            pending.reject(new Error("WebSocket closed"));
        }
        pendingTransactions.clear();
    });

    return {
        waitForTransaction: async (transactionId: string) => {
            await openPromise;
            return new Promise<WssTransactionUpdate>((resolve, reject) => {
                pendingTransactions.set(transactionId, { resolve, reject });
            });
        },
        close: () => {
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close();
            }
        },
    };
}

(async () => {
    const wallet = new Wallet(process.env.PRIVATE_KEY || "");

    // Configure smart account mode
    // Set useEIP7702 to true if using EIP-7702 mode
    const useEIP7702 = false;
    // Optional: set solanaAccountIndex when using EIP-7702 mode
    // SOLANA_ACCOUNT_INDEX.CLASSIC = use classic Solana address
    // SOLANA_ACCOUNT_INDEX.EIP7702 = use EIP-7702 derived Solana address
    const solanaAccountIndex: number | undefined = undefined;

    const universalAccount = new UniversalAccount({
        projectId: process.env.PROJECT_ID || "",
        projectClientKey: process.env.PROJECT_CLIENT_KEY || "",
        projectAppUuid: process.env.PROJECT_APP_UUID || "",
        ownerAddress: wallet.address,
        ...(useEIP7702 || solanaAccountIndex !== undefined
            ? {
                  smartAccountOptions: {
                      useEIP7702,
                      name: "UNIVERSAL",
                      version: process.env.UNIVERSAL_ACCOUNT_VERSION || "1.0.3",
                      ownerAddress: wallet.address,
                      ...(solanaAccountIndex !== undefined ? { solanaAccountIndex } : {}),
                  },
              }
            : {}),
        tradeConfig: {
            slippageBps: 100,
            universalGas: true,
            solanaMEVTipAmount: 0,
        },
    });

    const smartAccountOptions = await universalAccount.getSmartAccountOptions();
    console.log("Your UA EVM Address:", smartAccountOptions.smartAccountAddress);
    console.log("Your UA Solana Address:", smartAccountOptions.solanaSmartAccountAddress);

    // Connect WSS before sending transaction
    const wssUrl = process.env.UNIVERSALX_WSS_URL || DEFAULT_WSS_URL;
    const addresses = [
        smartAccountOptions.smartAccountAddress,
        smartAccountOptions.solanaSmartAccountAddress,
    ].filter((addr): addr is string => !!addr);
    const wssConnection = createWssConnection(wssUrl, addresses);

    // Create and send a buy transaction
    const transaction = await universalAccount.createBuyTransaction(
        {
            token: { chainId: CHAIN_ID.SOLANA_MAINNET, address: "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN" },
            amountInUSD: "0.001",
        },
        {
            addressLookupTableAccountAddresses: [],
        },
    );

    const sendResult = await universalAccount.sendTransaction(
        transaction,
        wallet.signMessageSync(getBytes(transaction.rootHash)),
    );

    console.log("\nTransaction sent:", sendResult.transactionId);
    console.log("Explorer:", `https://universalx.app/activity/details?id=${sendResult.transactionId}`);
    console.log("Waiting for transaction status via WebSocket...\n");

    // Wait for transaction completion via WSS
    const startTime = Date.now();
    const update = await wssConnection.waitForTransaction(sendResult.transactionId);
    const elapsed = Date.now() - startTime;

    if (update.data.status === 7) {
        console.log(`Transaction succeeded! (${elapsed}ms via WSS)`);
    } else {
        console.log(`Transaction failed with status ${update.data.status} (${elapsed}ms via WSS)`);
    }

    wssConnection.close();
})();
