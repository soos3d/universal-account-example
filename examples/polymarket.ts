//npm install @polymarket/clob-client
//npm install ethers
//Client initialization example and dumping API Keys

import { ApiKeyCreds, ClobClient, OrderType, Side } from '@polymarket/clob-client';
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

const host = 'https://clob.polymarket.com';
const privateKey = process.env.PRIVATE_KEY || '';
const rpcUrl = process.env.EVM_RPC_137 || '';
const providerV5 = new JsonRpcProviderV5(rpcUrl);
const provider = new JsonRpcProvider(rpcUrl);
// 代币地址
const USDC_ADDRESS = '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359'; // USDC
const USDC_E_ADDRESS = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'; // USDC.e

// Uniswap V3 SwapRouter 地址
const SWAP_ROUTER_ADDRESS = '0xE592427A0AEce92De3Edee1F18E0157C05861564';

// SwapRouter ABI
const SWAP_ROUTER_ABI = [
    'function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountIn)',
];

const signer = new Wallet(privateKey, providerV5);
const signatureType = 0;
(async () => {
    const creds = new ClobClient(host, 137, signer, undefined, signatureType).createOrDeriveApiKey();

    await approve('0.5');
    const response = await creds;
    console.log('credsResult', response);
    const clobClient = new ClobClient(host, 137, signer, response, signatureType, undefined, undefined, true);
    const resp2 = await clobClient.createAndPostOrder(
        {
            tokenID: '83479140651306794046790588004449066364152228067472874205697111967337978544729', //Use https://docs.polymarket.com/developers/gamma-markets-api/get-markets to grab a sample token
            price: 0.1,
            side: Side.BUY,
            size: 5,
        },
        undefined, //You'll need to adjust these based on the market. Get the tickSize and negRisk T/F from the get-markets above
        //{ tickSize: "0.001",negRisk: true },

        OrderType.GTC,
    );
    console.log(resp2);
})();

async function approve(amount: string) {
    const erc20 = new Interface([
        'function approve(address spender, uint256 amount) returns (bool)',
        'function balanceOf(address account) view returns (uint256)',
        'function allowance(address owner, address spender) view returns (uint256)',
    ]);
    // usdc.e
    const usdceContract = new Contract(USDC_E_ADDRESS, erc20, provider);
    const wallet = new WalletV6(process.env.PRIVATE_KEY || '');
    const universalAccountConfig: IUniversalAccountConfig = {
        projectId: process.env.PROJECT_ID || '',
        projectClientKey: process.env.PROJECT_CLIENT_KEY || '',
        projectAppUuid: process.env.PROJECT_APP_UUID || '',
        smartAccountOptions: {
            useEIP7702: true,
            name: 'UNIVERSAL',
            version: process.env.UNIVERSAL_ACCOUNT_VERSION || UNIVERSAL_ACCOUNT_VERSION,
            ownerAddress: wallet.address,
        },
    };

    const universalAccount = new UniversalAccount(universalAccountConfig);

    const balanceN = await usdceContract.balanceOf(wallet.address);
    console.log('balance', balanceN);
    // convert usdc.e
    const txs = [];
    const amountIn = (parseUnits(amount, 6) * 110n) / 100n;
    if (balanceN < parseUnits(amount, 6)) {
        txs.push({
            to: USDC_ADDRESS,
            data: erc20.encodeFunctionData('approve', [SWAP_ROUTER_ADDRESS, amountIn]),
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

        // 3. 构建交易数据
        const swapRouter = new Contract(SWAP_ROUTER_ADDRESS, SWAP_ROUTER_ABI, provider);
        const txData = swapRouter.interface.encodeFunctionData('exactOutputSingle', [params]);
        txs.push({
            to: SWAP_ROUTER_ADDRESS,
            data: txData,
        });
    }

    // approve usdc
    const transaction = await universalAccount.createUniversalTransaction({
        chainId: CHAIN_ID.POLYGON_MAINNET,
        expectTokens: txs.length > 0 ? [{ type: SUPPORTED_TOKEN_TYPE.USDC, amount: formatUnits(amountIn, 6) }] : [],
        transactions: [
            ...txs,
            {
                to: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
                // negRiskAdapter
                // maybe not need
                data: erc20.encodeFunctionData('approve', ['0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296', parseUnits(amount, 6)]),
            },
            {
                // negRiskExchange
                to: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
                data: erc20.encodeFunctionData('approve', ['0xC5d563A36AE78145C45a50134d48A1215220f80a', parseUnits(amount, 6)]),
            },
            {
                // exchangechange
                to: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
                data: erc20.encodeFunctionData('approve', ['0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E', parseUnits(amount, 6)]),
            }
        ],
    });

    const authorizations: EIP7702Authorization[] = [];
    for (const userOp of transaction.userOps) {
        if (!userOp.eip7702Delegated) {
            const authorization = wallet.authorizeSync(userOp.eip7702Auth);
            authorizations.push({
                userOpHash: userOp.userOpHash,
                signature: authorization.signature.serialized,
            });
        }
    }

    const sendResult = await universalAccount.sendTransaction(
        transaction,
        wallet.signMessageSync(getBytes(transaction.rootHash)),
        authorizations,
    );

    // console.log('sendResult', sendResult);
    console.log('sendResult.transactionId', sendResult.transactionId);
    console.log('explorer url', `https://universal-account-dev.vercel.app/activity/details?id=${sendResult.transactionId}`);
}
