import { AssetType, ClobClient, OrderType, Side } from '@polymarket/clob-client';
import { Wallet } from '@ethersproject/wallet';
import { JsonRpcProvider as JsonRpcProviderV5 } from '@ethersproject/providers';
import {
    CHAIN_ID,
    EIP7702Authorization,
    IUniversalAccountConfig,
    SUPPORTED_TOKEN_TYPE,
    UNIVERSAL_ACCOUNT_VERSION,
    UniversalAccount,
} from '@particle-network/universal-account-sdk';
import { config } from 'dotenv';
import { formatUnits, getBytes, Wallet as WalletV6, Interface, parseUnits, JsonRpcProvider, Contract } from 'ethers';

config();

const privateKey = process.env.PRIVATE_KEY || '';
const rpcUrl = process.env.EVM_RPC_137 || '';

(async () => {
    const host = 'https://clob.polymarket.com';
    // @see https://docs.polymarket.com/developers/CLOB/orders/orders#signature-types
    const signatureType = 0;
    const providerV5 = new JsonRpcProviderV5(rpcUrl);
    const signer = new Wallet(privateKey, providerV5);
    // @see https://polymarket.com/event/fed-decision-in-april
    const polymaketTokenId = '83479140651306794046790588004449066364152228067472874205697111967337978544729';
    const polymarketBuyAmount = 1;
    // @see https://github.com/Polymarket/clob-client
    const creds = new ClobClient(host, 137, signer, undefined, signatureType).createOrDeriveApiKey();
    const apiCreds = await creds;
    console.log('credsResult', apiCreds);

    // Universal Transaction: prepare & approve amount usdc.e to polymarket contract
    let result: boolean;
    result = await prepareAndApproveUSDCEUniversalTransaction(polymarketBuyAmount.toString(), privateKey, rpcUrl);
    if (!result) {
        console.error('Failed to prepare and approve Universal Transaction');
        return;
    }

    const clobClient = new ClobClient(host, 137, signer, apiCreds, signatureType, undefined, undefined, true);

    // buy $1
    let response: any;
    response = await clobClient.createAndPostMarketOrder(
        {
            tokenID: polymaketTokenId,
            side: Side.BUY,
            amount: polymarketBuyAmount,
        },
        undefined,
        OrderType.FOK,
    );
    console.log('Buy $1 response', response);

    // get all shares
    const balance = await clobClient.getBalanceAllowance({
        asset_type: AssetType.CONDITIONAL,
        token_id: polymaketTokenId
    });
    console.log('All shares', balance);
    
    // approve CTF
    result = await approveCTFUniversalTransaction(privateKey);
    if (!result) {
        console.error('Failed to approve CTF Universal Transaction');
        return;
    }

    // sell all shares
    response = await clobClient.createAndPostMarketOrder(
        {
            tokenID: polymaketTokenId,
            side: Side.SELL,
            amount: Number(balance.balance),
        },
        undefined,
        OrderType.FOK,
    );
    console.log('Sell all shares response', response);
})();

async function prepareAndApproveUSDCEUniversalTransaction(amount: string, privateKey: string, polygonRpcUrl: string): Promise<boolean> {
    const provider = new JsonRpcProvider(polygonRpcUrl);
    const USDC_ADDRESS = '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359';
    const USDC_E_ADDRESS = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174';
    const ERC20_ABI = new Interface([
        'function approve(address spender, uint256 amount) returns (bool)',
        'function balanceOf(address account) view returns (uint256)',
        'function allowance(address owner, address spender) view returns (uint256)',
    ]);
    // Uniswap v3 router address
    const SWAP_ROUTER_ADDRESS = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
    const SWAP_ROUTER_ABI = [
        'function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountIn)',
    ];

    // 7702 Mode: EVM address is also the EOA address(owner address)
    // Polymarket is on Polygon, so you can deposit BNB/USDT/USDC/SOL/ETH on other EVM chains or Solana to have a invisible cross-chain transaction
    const wallet = new WalletV6(privateKey || '');
    const universalAccountConfig: IUniversalAccountConfig = {
        projectId: process.env.PROJECT_ID || '',
        projectClientKey: process.env.PROJECT_CLIENT_KEY || '',
        projectAppUuid: process.env.PROJECT_APP_UUID || '',
        smartAccountOptions: {
            // 7702 Mode: EVM address is also the EOA address(owner address)
            useEIP7702: true,
            name: 'UNIVERSAL',
            version: process.env.UNIVERSAL_ACCOUNT_VERSION || UNIVERSAL_ACCOUNT_VERSION,
            ownerAddress: wallet.address,
        },
    };
    const universalAccount = new UniversalAccount(universalAccountConfig);
    // 7702 Mode: EVM address is also the EOA address(owner address)
    console.log('Universal Account Owner Address', (await universalAccount.getSmartAccountOptions()).ownerAddress);
    console.log('Universal Account EVM Address', (await universalAccount.getSmartAccountOptions()).smartAccountAddress);
    console.log('Universal Account Solana Address', (await universalAccount.getSmartAccountOptions()).solanaSmartAccountAddress);

    // usdc.e
    const usdceContract = new Contract(USDC_E_ADDRESS, ERC20_ABI, provider);
    const balanceUsdce = await usdceContract.balanceOf(wallet.address);
    console.log('Current balance of usdc.e', balanceUsdce);

    const txs = [];

    // swap usdc to usdc.e
    // 110% of amount of USDC expected
    const amountIn = (parseUnits(amount, 6) * 110n) / 100n;
    if (balanceUsdce < parseUnits(amount, 6)) {
        txs.push({
            to: USDC_ADDRESS,
            data: ERC20_ABI.encodeFunctionData('approve', [SWAP_ROUTER_ADDRESS, amountIn]),
        });

        const params = {
            tokenIn: USDC_ADDRESS,
            tokenOut: USDC_E_ADDRESS,
            fee: 100,
            recipient: wallet.address,
            deadline: Math.floor(Date.now() / 1000) + 60 * 20,
            amountOut: parseUnits(amount, 6),
            amountInMaximum: amountIn,
            sqrtPriceLimitX96: 0,
        };

        const swapRouter = new Contract(SWAP_ROUTER_ADDRESS, SWAP_ROUTER_ABI, provider);
        const txData = swapRouter.interface.encodeFunctionData('exactOutputSingle', [params]);
        txs.push({
            to: SWAP_ROUTER_ADDRESS,
            data: txData,
        });
    }

    try {
        // Universal Transaction: get usdc.e and approve usdc.e to polymarket contracts
        const universalTransaction = await universalAccount.createUniversalTransaction({
            chainId: CHAIN_ID.POLYGON_MAINNET,
            expectTokens: txs.length > 0 ? [{ type: SUPPORTED_TOKEN_TYPE.USDC, amount: formatUnits(amountIn, 6) }] : [],
            transactions: [
                ...txs,
                // negRiskAdapter
                {
                    to: USDC_E_ADDRESS,
                    data: ERC20_ABI.encodeFunctionData('approve', ['0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296', parseUnits(amount, 6)]),
                },
                // negRiskExchange
                {
                    to: USDC_E_ADDRESS,
                    data: ERC20_ABI.encodeFunctionData('approve', ['0xC5d563A36AE78145C45a50134d48A1215220f80a', parseUnits(amount, 6)]),
                },
                // exchangechange
                {
                    to: USDC_E_ADDRESS,
                    data: ERC20_ABI.encodeFunctionData('approve', ['0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E', parseUnits(amount, 6)]),
                },
            ],
        });

        // Handle 7702 Authorization
        const authorizations: EIP7702Authorization[] = [];
        for (const userOp of universalTransaction.userOps) {
            if (!userOp.eip7702Delegated) {
                const authorization = wallet.authorizeSync(userOp.eip7702Auth);
                authorizations.push({
                    userOpHash: userOp.userOpHash,
                    signature: authorization.signature.serialized,
                });
            }
        }

        const sendResult = await universalAccount.sendTransaction(
            universalTransaction,
            wallet.signMessageSync(getBytes(universalTransaction.rootHash)),
            authorizations,
        );

        console.log('sendResult.transactionId', sendResult.transactionId);
        console.log('explorer url', `https://universalx.app/activity/details?id=${sendResult.transactionId}`);

        return true;
    } catch (error: any) {
        console.error('Error preparing and approving Universal Transaction', error?.message);

        return false;
    }

}

async function approveCTFUniversalTransaction(privateKey: string): Promise<boolean> {
    const CTF_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
    const CTF_ABI = new Interface([
        "function setApprovalForAll(address operator, bool approved) external",
    ]);

    // 7702 Mode: EVM address is also the EOA address(owner address)
    // Polymarket is on Polygon, so you can deposit BNB/USDT/USDC/SOL/ETH on other EVM chains or Solana to have a invisible cross-chain transaction
    const wallet = new WalletV6(privateKey || '');
    const universalAccountConfig: IUniversalAccountConfig = {
        projectId: process.env.PROJECT_ID || '',
        projectClientKey: process.env.PROJECT_CLIENT_KEY || '',
        projectAppUuid: process.env.PROJECT_APP_UUID || '',
        smartAccountOptions: {
            // 7702 Mode: EVM address is also the EOA address(owner address)
            useEIP7702: true,
            name: 'UNIVERSAL',
            version: process.env.UNIVERSAL_ACCOUNT_VERSION || UNIVERSAL_ACCOUNT_VERSION,
            ownerAddress: wallet.address,
        },
    };
    const universalAccount = new UniversalAccount(universalAccountConfig);
    // 7702 Mode: EVM address is also the EOA address(owner address)
    console.log('Universal Account Owner Address', (await universalAccount.getSmartAccountOptions()).ownerAddress);
    console.log('Universal Account EVM Address', (await universalAccount.getSmartAccountOptions()).smartAccountAddress);
    console.log('Universal Account Solana Address', (await universalAccount.getSmartAccountOptions()).solanaSmartAccountAddress);

    // approve CTF
    try {
        const universalTransaction = await universalAccount.createUniversalTransaction({
            chainId: CHAIN_ID.POLYGON_MAINNET,
            expectTokens: [],
            transactions: [
                // negRiskAdapter
                {
                    to: CTF_ADDRESS,
                    data: CTF_ABI.encodeFunctionData('setApprovalForAll', ['0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296', true]),
                },
                // negRiskExchange
                {
                    to: CTF_ADDRESS,
                    data: CTF_ABI.encodeFunctionData('setApprovalForAll', ['0xC5d563A36AE78145C45a50134d48A1215220f80a', true]),
                },
                // exchangechange
                {
                    to: CTF_ADDRESS,
                    data: CTF_ABI.encodeFunctionData('setApprovalForAll', ['0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E', true]),
                },
            ],
        });

        const sendResult = await universalAccount.sendTransaction(universalTransaction, wallet.signMessageSync(getBytes(universalTransaction.rootHash)));

        console.log('sendResult.transactionId', sendResult.transactionId);
        console.log('explorer url', `https://universalx.app/activity/details?id=${sendResult.transactionId}`);

        return true;
    } catch (error: any) {
        console.error('Error approving CTF Universal Transaction', error?.message);

        return false;
    }
}
