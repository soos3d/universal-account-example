import { config } from "dotenv";
import {
    CHAIN_ID,
    EIP7702Authorization,
    IUniversalAccountConfig,
    SOLANA_ACCOUNT_INDEX,
    SUPPORTED_TOKEN_TYPE,
    UNIVERSAL_ACCOUNT_VERSION,
    UniversalAccount,
} from "@particle-network/universal-account-sdk";
import { formatUnits, getBytes, hashAuthorization, Wallet } from "ethers";

config();

// Test owner with known SVM balance
// Normal mode -> UA Solana: EQajWWFmKLwCoUzik8cBKVgacvCZr9prJ4J4oSvnD1Z4 (has SOL + USDC)
const TEST_OWNER_ADDRESS = "0x2746D4741F2B69CbE33EC4A28BF250C7C4D18c54";
const EXPECTED_SOLANA_ADDRESS_NORMAL = "EQajWWFmKLwCoUzik8cBKVgacvCZr9prJ4J4oSvnD1Z4";
const RPC_URL = process.env.UNIVERSALX_RPC_URL;

function createNormalUA(): UniversalAccount {
    return new UniversalAccount({
        projectId: process.env.PROJECT_ID || "",
        projectClientKey: process.env.PROJECT_CLIENT_KEY || "",
        projectAppUuid: process.env.PROJECT_APP_UUID || "",
        ownerAddress: TEST_OWNER_ADDRESS,
        rpcUrl: RPC_URL,
        tradeConfig: {
            slippageBps: 100,
            universalGas: true,
        },
    });
}

function createEIP7702UA(): UniversalAccount {
    const uaConfig: IUniversalAccountConfig = {
        projectId: process.env.PROJECT_ID || "",
        projectClientKey: process.env.PROJECT_CLIENT_KEY || "",
        projectAppUuid: process.env.PROJECT_APP_UUID || "",
        rpcUrl: RPC_URL,
        smartAccountOptions: {
            useEIP7702: true,
            name: "UNIVERSAL",
            version: process.env.UNIVERSAL_ACCOUNT_VERSION || UNIVERSAL_ACCOUNT_VERSION,
            ownerAddress: TEST_OWNER_ADDRESS,
        },
    };
    return new UniversalAccount(uaConfig);
}

// ==================== Test 1: Normal Mode - getPrimaryAssets ====================
async function testNormalGetPrimaryAssets() {
    console.log("========== Test 1: Normal Mode - getPrimaryAssets ==========");
    console.log("RPC URL:", RPC_URL || "(default)");

    const ua = createNormalUA();
    const opts = await ua.getSmartAccountOptions();
    console.log("UA EVM Address:", opts.smartAccountAddress);
    console.log("UA Solana Address:", opts.solanaSmartAccountAddress);

    if (opts.solanaSmartAccountAddress !== EXPECTED_SOLANA_ADDRESS_NORMAL) {
        console.error(`FAIL: Expected Solana address ${EXPECTED_SOLANA_ADDRESS_NORMAL}, got ${opts.solanaSmartAccountAddress}`);
        process.exit(1);
    }
    console.log("PASS: Solana address derivation correct");

    const primaryAssets = await ua.getPrimaryAssets();
    console.log("Total USD:", primaryAssets.totalAmountInUSD);

    // Verify SOL on Solana
    const solAsset = primaryAssets.assets.find((a: any) => a.tokenType === "sol");
    const solChain = solAsset?.chainAggregation.find((c: any) => c.token.chainId === 101);

    if (!solAsset || solAsset.amount === 0) {
        console.error("FAIL: SOL amount is 0, expected non-zero");
        process.exit(1);
    }
    console.log(`PASS: SOL amount=${solAsset.amount}, USD=${solAsset.amountInUSD}`);

    if (!solChain || solChain.amount === 0) {
        console.error("FAIL: SOL chainId=101 amount is 0");
        process.exit(1);
    }
    console.log(`PASS: SOL on chainId=101: amount=${solChain.amount}, rawAmount=${solChain.rawAmount}`);

    // Print all non-zero
    for (const asset of primaryAssets.assets) {
        if (asset.amount > 0) {
            console.log(`  ${asset.tokenType}: amount=${asset.amount}, USD=${asset.amountInUSD}`);
        }
    }
}

// ==================== Test 2: EIP-7702 Mode - getPrimaryAssets ====================
async function testEIP7702GetPrimaryAssets() {
    console.log("\n========== Test 2: EIP-7702 Mode - getPrimaryAssets ==========");

    const ua = createEIP7702UA();
    const opts = await ua.getSmartAccountOptions();
    console.log("UA EVM Address (7702):", opts.smartAccountAddress);
    console.log("UA Solana Address (7702):", opts.solanaSmartAccountAddress);

    const primaryAssets = await ua.getPrimaryAssets();
    console.log("Total USD:", primaryAssets.totalAmountInUSD);

    // 7702 mode has different SVM address, verify EVM balances are returned
    if (primaryAssets.totalAmountInUSD === undefined || primaryAssets.totalAmountInUSD === null) {
        console.error("FAIL: totalAmountInUSD is missing");
        process.exit(1);
    }
    console.log("PASS: totalAmountInUSD returned");

    // Print all non-zero
    for (const asset of primaryAssets.assets) {
        if (asset.amount > 0) {
            console.log(`  ${asset.tokenType}: amount=${asset.amount}, USD=${asset.amountInUSD}`);
            for (const chain of asset.chainAggregation) {
                if (chain.amount > 0) {
                    console.log(`    chainId=${chain.token.chainId}: amount=${chain.amount}, rawAmount=${chain.rawAmount}`);
                }
            }
        }
    }

    // Verify SVM balance on 7702's own Solana address
    const solAsset = primaryAssets.assets.find((a: any) => a.tokenType === "sol");
    const solChain = solAsset?.chainAggregation.find((c: any) => c.token.chainId === 101);
    if (solChain && solChain.amount > 0) {
        console.log(`PASS: SOL on 7702 Solana: amount=${solChain.amount}`);
    } else {
        console.log("INFO: No SOL on 7702 Solana address (expected if no funds deposited)");
    }
}

// ==================== Test 2b: EIP-7702 Classic Mode - getPrimaryAssets ====================
async function testEIP7702ClassicGetPrimaryAssets() {
    console.log("\n========== Test 2b: EIP-7702 Classic Mode - getPrimaryAssets ==========");

    const uaConfig: IUniversalAccountConfig = {
        projectId: process.env.PROJECT_ID || "",
        projectClientKey: process.env.PROJECT_CLIENT_KEY || "",
        projectAppUuid: process.env.PROJECT_APP_UUID || "",
        rpcUrl: RPC_URL,
        smartAccountOptions: {
            useEIP7702: true,
            name: "UNIVERSAL",
            version: process.env.UNIVERSAL_ACCOUNT_VERSION || UNIVERSAL_ACCOUNT_VERSION,
            ownerAddress: TEST_OWNER_ADDRESS,
            solanaAccountIndex: SOLANA_ACCOUNT_INDEX.CLASSIC,
        },
    };
    const ua = new UniversalAccount(uaConfig);
    const opts = await ua.getSmartAccountOptions();
    console.log("UA EVM Address (7702 Classic):", opts.smartAccountAddress);
    console.log("UA Solana Address (7702 Classic):", opts.solanaSmartAccountAddress);

    const primaryAssets = await ua.getPrimaryAssets();
    console.log("Total USD:", primaryAssets.totalAmountInUSD);

    if (primaryAssets.totalAmountInUSD === undefined || primaryAssets.totalAmountInUSD === null) {
        console.error("FAIL: totalAmountInUSD is missing");
        process.exit(1);
    }
    console.log("PASS: totalAmountInUSD returned");

    // Print all non-zero
    for (const asset of primaryAssets.assets) {
        if (asset.amount > 0) {
            console.log(`  ${asset.tokenType}: amount=${asset.amount}, USD=${asset.amountInUSD}`);
            for (const chain of asset.chainAggregation) {
                if (chain.amount > 0) {
                    console.log(`    chainId=${chain.token.chainId}: amount=${chain.amount}, rawAmount=${chain.rawAmount}`);
                }
            }
        }
    }

    // Classic mode should share Solana address with Normal mode
    const solAsset = primaryAssets.assets.find((a: any) => a.tokenType === "sol");
    const solChain = solAsset?.chainAggregation.find((c: any) => c.token.chainId === 101);
    if (solChain && solChain.amount > 0) {
        console.log(`PASS: SOL on 7702 Classic Solana: amount=${solChain.amount}`);
    } else {
        console.log("INFO: No SOL on 7702 Classic Solana address (expected if no funds deposited)");
    }
}

// ==================== Test 3: EIP-7702 Mode - Buy EVM Token ====================
async function testEIP7702BuyEVM() {
    console.log("\n========== Test 3: EIP-7702 Mode - Buy EVM Token ==========");

    const wallet = new Wallet(process.env.PRIVATE_KEY || "");
    const uaConfig: IUniversalAccountConfig = {
        projectId: process.env.PROJECT_ID || "",
        projectClientKey: process.env.PROJECT_CLIENT_KEY || "",
        projectAppUuid: process.env.PROJECT_APP_UUID || "",
        rpcUrl: RPC_URL,
        smartAccountOptions: {
            useEIP7702: true,
            name: "UNIVERSAL",
            version: process.env.UNIVERSAL_ACCOUNT_VERSION || UNIVERSAL_ACCOUNT_VERSION,
            ownerAddress: wallet.address,
        },
        tradeConfig: {
            slippageBps: 100,
            universalGas: true,
        },
    };

    const ua = new UniversalAccount(uaConfig);
    const opts = await ua.getSmartAccountOptions();
    console.log("UA EVM Address (7702):", opts.smartAccountAddress);
    console.log("UA Solana Address (7702):", opts.solanaSmartAccountAddress);

    // Create buy transaction for ARB on Arbitrum
    const transaction = await ua.createBuyTransaction({
        token: { chainId: CHAIN_ID.ARBITRUM_MAINNET_ONE, address: "0x912CE59144191C1204E64559FE8253a0e49E6548" },
        amountInUSD: "0.001",
    });

    console.log("PASS: createBuyTransaction succeeded");
    console.log("Transaction rootHash:", transaction.rootHash);
    console.log("UserOps count:", transaction.userOps.length);

    const feeQuote = transaction.feeQuotes[0];
    if (feeQuote) {
        const fee = feeQuote.fees.totals;
        console.log("Total fee USD:", `$${formatUnits(fee.feeTokenAmountInUSD, 18)}`);
    }

    // Handle 7702 Authorization
    const authorizations: EIP7702Authorization[] = [];
    const nonceMap = new Map<number, string>();
    for (const userOp of transaction.userOps) {
        if (!!userOp.eip7702Auth && !userOp.eip7702Delegated) {
            let signatureSerialized = nonceMap.get(userOp.eip7702Auth.nonce);
            if (!signatureSerialized) {
                const dataHash = hashAuthorization(userOp.eip7702Auth);
                const signature = wallet.signingKey.sign(dataHash);
                signatureSerialized = signature.serialized;
                nonceMap.set(userOp.eip7702Auth.nonce, signatureSerialized);
            }
            authorizations.push({
                userOpHash: userOp.userOpHash,
                signature: signatureSerialized,
            });
        }
    }
    console.log("7702 authorizations:", authorizations.length);

    // Sign and send
    const sendResult = await ua.sendTransaction(
        transaction,
        wallet.signMessageSync(getBytes(transaction.rootHash)),
        authorizations,
    );

    console.log("PASS: sendTransaction succeeded");
    console.log("Transaction ID:", sendResult.transactionId);
    console.log("Explorer URL:", `https://universalx.app/activity/details?id=${sendResult.transactionId}`);
}

// ==================== Test 4: EIP-7702 Mode - Buy Solana Token (solanaAccountIndex=EIP7702) ====================
async function testEIP7702BuySolanaWithEIP7702Index() {
    console.log("\n========== Test 4: EIP-7702 Mode - Buy Solana Token (solanaAccountIndex=EIP7702) ==========");

    const wallet = new Wallet(process.env.PRIVATE_KEY || "");
    const uaConfig: IUniversalAccountConfig = {
        projectId: process.env.PROJECT_ID || "",
        projectClientKey: process.env.PROJECT_CLIENT_KEY || "",
        projectAppUuid: process.env.PROJECT_APP_UUID || "",
        rpcUrl: RPC_URL,
        smartAccountOptions: {
            useEIP7702: true,
            name: "UNIVERSAL",
            version: process.env.UNIVERSAL_ACCOUNT_VERSION || UNIVERSAL_ACCOUNT_VERSION,
            ownerAddress: wallet.address,
            solanaAccountIndex: SOLANA_ACCOUNT_INDEX.EIP7702,
        },
        tradeConfig: {
            slippageBps: 100,
            universalGas: true,
            solanaMEVTipAmount: 0,
        },
    };

    const ua = new UniversalAccount(uaConfig);
    const opts = await ua.getSmartAccountOptions();
    console.log("UA EVM Address (7702):", opts.smartAccountAddress);
    console.log("UA Solana Address (7702, index=EIP7702):", opts.solanaSmartAccountAddress);

    // Buy TRUMP on Solana - $0.001
    const transaction = await ua.createBuyTransaction({
        token: { chainId: CHAIN_ID.SOLANA_MAINNET, address: "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN" },
        amountInUSD: "0.001",
    });

    console.log("PASS: createBuyTransaction (Solana, solanaAccountIndex=EIP7702) succeeded");
    console.log("Transaction rootHash:", transaction.rootHash);
    console.log("UserOps count:", transaction.userOps.length);

    const feeQuote = transaction.feeQuotes[0];
    if (feeQuote) {
        const fee = feeQuote.fees.totals;
        console.log("Total fee USD:", `$${formatUnits(fee.feeTokenAmountInUSD, 18)}`);
    }

    // Handle 7702 Authorization
    const authorizations: EIP7702Authorization[] = [];
    const nonceMap = new Map<number, string>();
    for (const userOp of transaction.userOps) {
        if (!!userOp.eip7702Auth && !userOp.eip7702Delegated) {
            let signatureSerialized = nonceMap.get(userOp.eip7702Auth.nonce);
            if (!signatureSerialized) {
                const dataHash = hashAuthorization(userOp.eip7702Auth);
                const signature = wallet.signingKey.sign(dataHash);
                signatureSerialized = signature.serialized;
                nonceMap.set(userOp.eip7702Auth.nonce, signatureSerialized);
            }
            authorizations.push({
                userOpHash: userOp.userOpHash,
                signature: signatureSerialized,
            });
        }
    }
    console.log("7702 authorizations:", authorizations.length);

    // Sign and send
    const sendResult = await ua.sendTransaction(
        transaction,
        wallet.signMessageSync(getBytes(transaction.rootHash)),
        authorizations,
    );

    console.log("PASS: sendTransaction (Solana, solanaAccountIndex=EIP7702) succeeded");
    console.log("Transaction ID:", sendResult.transactionId);
    console.log("Explorer URL:", `https://universalx.app/activity/details?id=${sendResult.transactionId}`);
}

// ==================== Test 5: EIP-7702 Mode - Buy Solana Token (solanaAccountIndex=CLASSIC) ====================
async function testEIP7702BuySolanaWithClassicIndex() {
    console.log("\n========== Test 5: EIP-7702 Mode - Buy Solana Token (solanaAccountIndex=CLASSIC) ==========");

    const wallet = new Wallet(process.env.PRIVATE_KEY || "");
    const uaConfig: IUniversalAccountConfig = {
        projectId: process.env.PROJECT_ID || "",
        projectClientKey: process.env.PROJECT_CLIENT_KEY || "",
        projectAppUuid: process.env.PROJECT_APP_UUID || "",
        rpcUrl: RPC_URL,
        smartAccountOptions: {
            useEIP7702: true,
            name: "UNIVERSAL",
            version: process.env.UNIVERSAL_ACCOUNT_VERSION || UNIVERSAL_ACCOUNT_VERSION,
            ownerAddress: wallet.address,
            solanaAccountIndex: SOLANA_ACCOUNT_INDEX.CLASSIC,
        },
        tradeConfig: {
            slippageBps: 100,
            universalGas: true,
            solanaMEVTipAmount: 0,
        },
    };

    const ua = new UniversalAccount(uaConfig);
    const opts = await ua.getSmartAccountOptions();
    console.log("UA EVM Address (7702):", opts.smartAccountAddress);
    console.log("UA Solana Address (7702, index=CLASSIC):", opts.solanaSmartAccountAddress);

    // Buy TRUMP on Solana - $0.001
    const transaction = await ua.createBuyTransaction({
        token: { chainId: CHAIN_ID.SOLANA_MAINNET, address: "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN" },
        amountInUSD: "0.001",
    });

    console.log("PASS: createBuyTransaction (Solana, solanaAccountIndex=CLASSIC) succeeded");
    console.log("Transaction rootHash:", transaction.rootHash);
    console.log("UserOps count:", transaction.userOps.length);

    const feeQuote = transaction.feeQuotes[0];
    if (feeQuote) {
        const fee = feeQuote.fees.totals;
        console.log("Total fee USD:", `$${formatUnits(fee.feeTokenAmountInUSD, 18)}`);
    }

    // Handle 7702 Authorization
    const authorizations: EIP7702Authorization[] = [];
    const nonceMap = new Map<number, string>();
    for (const userOp of transaction.userOps) {
        if (!!userOp.eip7702Auth && !userOp.eip7702Delegated) {
            let signatureSerialized = nonceMap.get(userOp.eip7702Auth.nonce);
            if (!signatureSerialized) {
                const dataHash = hashAuthorization(userOp.eip7702Auth);
                const signature = wallet.signingKey.sign(dataHash);
                signatureSerialized = signature.serialized;
                nonceMap.set(userOp.eip7702Auth.nonce, signatureSerialized);
            }
            authorizations.push({
                userOpHash: userOp.userOpHash,
                signature: signatureSerialized,
            });
        }
    }
    console.log("7702 authorizations:", authorizations.length);

    // Sign and send
    const sendResult = await ua.sendTransaction(
        transaction,
        wallet.signMessageSync(getBytes(transaction.rootHash)),
        authorizations,
    );

    console.log("PASS: sendTransaction (Solana, solanaAccountIndex=CLASSIC) succeeded");
    console.log("Transaction ID:", sendResult.transactionId);
    console.log("Explorer URL:", `https://universalx.app/activity/details?id=${sendResult.transactionId}`);
}

(async () => {
    try {
        await testNormalGetPrimaryAssets();
        await testEIP7702GetPrimaryAssets();
        await testEIP7702ClassicGetPrimaryAssets();
        await testEIP7702BuyEVM();
        await testEIP7702BuySolanaWithEIP7702Index();
        await testEIP7702BuySolanaWithClassicIndex();
        console.log("\n========== All tests passed! ==========");
    } catch (error) {
        console.error("\nTest failed with error:", error);
        process.exit(1);
    }
})();
