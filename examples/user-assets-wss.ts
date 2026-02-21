import { config } from "dotenv";
import { SOLANA_ACCOUNT_INDEX, UniversalAccount } from "@particle-network/universal-account-sdk";
import { Wallet } from "ethers";
import WebSocket from "ws";

config();

const HEARTBEAT_INTERVAL = 5_000; // 5s
const DEFAULT_WSS_URL = "wss://universal-app-ws-proxy.particle.network";

interface WssUserAssetsMessage {
    channel: "user-assets";
    params: {
        ownerAddress: string;
        name: string;
        version: string;
        useEIP7702: boolean;
        solanaAccountIndex?: number;
    };
    data: {
        assets: Array<{
            chainId: number;
            address: string;
            amountOnChain: string;
            isToken2022: boolean;
            accountExists: boolean;
        }>;
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

(async () => {
    const wallet = new Wallet(process.env.PRIVATE_KEY || "");
    const universalAccount = new UniversalAccount({
        projectId: process.env.PROJECT_ID || "",
        projectClientKey: process.env.PROJECT_CLIENT_KEY || "",
        projectAppUuid: process.env.PROJECT_APP_UUID || "",
        ownerAddress: wallet.address,
    });

    const smartAccountOptions = await universalAccount.getSmartAccountOptions();
    console.log("Your UA EVM Address:", smartAccountOptions.smartAccountAddress);
    console.log("Your UA Solana Address:", smartAccountOptions.solanaSmartAccountAddress);

    const wssUrl = process.env.UNIVERSALX_WSS_URL || DEFAULT_WSS_URL;
    const ws = new WebSocket(wssUrl);
    setupHeartbeat(ws);

    // Configure smart account mode
    // Set useEIP7702 to true if using EIP-7702 mode
    const useEIP7702 = false;
    // Optional: set solanaAccountIndex when using EIP-7702 mode
    // SOLANA_ACCOUNT_INDEX.CLASSIC = use classic Solana address
    // SOLANA_ACCOUNT_INDEX.EIP7702 = use EIP-7702 derived Solana address
    const solanaAccountIndex: number | undefined = undefined;

    const subscribeParams = {
        ownerAddress: wallet.address,
        name: "UNIVERSAL",
        version: process.env.UNIVERSAL_ACCOUNT_VERSION || "1.0.3",
        useEIP7702,
        ...(solanaAccountIndex !== undefined ? { solanaAccountIndex } : {}),
    };

    ws.on("open", () => {
        console.log("\nWebSocket connected to", wssUrl);
        const subscribeMessage = {
            type: "subscribe",
            channel: "user-assets",
            params: subscribeParams,
        };
        ws.send(JSON.stringify(subscribeMessage));
        console.log("Subscribed to user-assets channel");
        console.log("Waiting for asset updates... (press Ctrl+C to exit)\n");
    });

    ws.on("message", (data: WebSocket.Data) => {
        try {
            const message = JSON.parse(data.toString()) as WssUserAssetsMessage;
            if (message.channel === "user-assets" && message.data?.assets) {
                console.log(`[${new Date().toISOString()}] Received asset update:`);
                console.log(`  Total assets: ${message.data.assets.length}`);
                for (const asset of message.data.assets) {
                    if (BigInt(asset.amountOnChain) > 0n) {
                        console.log(
                            `  Chain ${asset.chainId} | ${asset.address} | amount: ${asset.amountOnChain}${asset.isToken2022 ? " (Token2022)" : ""}`
                        );
                    }
                }
                console.log();
            }
        } catch (e) {
            // Ignore parse errors
        }
    });

    ws.on("error", (err) => {
        console.error("WebSocket error:", err.message);
    });

    ws.on("close", () => {
        console.log("WebSocket connection closed");
        process.exit(0);
    });

    // Graceful shutdown
    const cleanup = () => {
        console.log("\nClosing WebSocket connection...");
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            const unsubscribeMessage = {
                type: "unsubscribe",
                channel: "user-assets",
                params: subscribeParams,
            };
            ws.send(JSON.stringify(unsubscribeMessage));
            ws.close();
        }
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
})();
