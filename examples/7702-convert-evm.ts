import { config } from 'dotenv';
import {
    CHAIN_ID,
    EIP7702Authorization,
    IUniversalAccountConfig,
    SUPPORTED_TOKEN_TYPE,
    UNIVERSAL_ACCOUNT_VERSION,
    UniversalAccount,
} from '@particle-network/universal-account-sdk';
import { getBytes, hashAuthorization, Wallet } from 'ethers';

config();

(async () => {
    try {
        const wallet = new Wallet(process.env.PRIVATE_KEY || '');
        const universalAccountConfig: IUniversalAccountConfig = {
            projectId: process.env.PROJECT_ID || '',
            projectClientKey: process.env.PROJECT_CLIENT_KEY || '',
            projectAppUuid: process.env.PROJECT_APP_UUID || '',
            smartAccountOptions: {
                useEIP7702: true,
                name: 'UNIVERSAL',
                version: process.env.UNIVERSAL_ACCOUNT_VERSION || UNIVERSAL_ACCOUNT_VERSION,
                ownerAddress: wallet.address,
                // Optional: set solanaAccountIndex to control which Solana address is derived
                // SOLANA_ACCOUNT_INDEX.CLASSIC = use classic Solana smart account address
                // SOLANA_ACCOUNT_INDEX.EIP7702 = use EIP-7702 derived Solana address
                // solanaAccountIndex: SOLANA_ACCOUNT_INDEX.CLASSIC,
            },
        };

        const universalAccount = new UniversalAccount(universalAccountConfig);
        const transaction = await universalAccount.createConvertTransaction({
            expectToken: { type: SUPPORTED_TOKEN_TYPE.USDT, amount: '0.0001' },
            chainId: CHAIN_ID.BSC_MAINNET,
        });

        // Handle 7702 Authorization
        const authorizations: EIP7702Authorization[] = [];
        const nonceMap = new Map<number, string>();
        for (const userOp of transaction.userOps) {
            if (!!userOp.eip7702Auth && !userOp.eip7702Delegated) {
                let signatureSerialized = nonceMap.get(userOp.eip7702Auth.nonce);
                if (!signatureSerialized) {
                    // const authorization = wallet.authorizeSync(userOp.eip7702Auth);
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

        const sendResult = await universalAccount.sendTransaction(
            transaction,
            wallet.signMessageSync(getBytes(transaction.rootHash)),
            authorizations,
        );

        console.log('sendResult', sendResult);
        console.log('sendResult.transactionId', sendResult.transactionId);
        console.log('explorer url', `https://universalx.app/activity/details?id=${sendResult.transactionId}`);
    } catch (error) {
        console.error(error);
    }
})();
