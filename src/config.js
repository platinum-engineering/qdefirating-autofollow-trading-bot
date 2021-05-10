const { ChainId } = require('@uniswap/sdk')

const config = {
	blockChainName: process.env.BLOCKCHAIN_NAME,
	apis: {
		nodeApiUrl: process.env.NODE_API_URL,
		nodeApiWsUrl: process.env.NODE_API_WS_URL,
		chainScannerApiUrl: process.env.CHAIN_SCANER_API_URL,
		chainScannerApiKey: process.env.CHAIN_SCANER_API_KEY,
	},
	followOnlySucceeded: process.env.ONLY_SUCCESSFUL === 'true',
	targetWallet: process.env.TARGET_WALLET.toLowerCase(),
	stopBuying: process.env.STOP_BUYING === 'true',
	stopSelling: process.env.STOP_SELLING === 'true',
	mainWallet: process.env.WALLET_FROM.toLowerCase(),
	mainWalletKey: process.env.WALLET_FROM_PRIVATE_KEY,
	routerAddress: process.env.ROUTER_ADDRESS.toLowerCase(),
	wethContract: process.env.WETH_CONTRACT_ADDRESS.toLowerCase(),
}

switch (config.blockChainName) {
	case 'mainnet':
		config.chainId = ChainId.MAINNET
		config.chainData = { chain: 'mainnet' }
		break
	case 'rinkeby':
		config.chainId = ChainId.MAINNET
		config.chainData = { chain: 'rinkeby' }
		break
	case 'bsc-mainnet':
		config.chainId = 56
		config.chainData = { chain: 'bsc-mainnet', networkId: 56, chainId: 56 }
		break
	case 'bsc-testnet':
		config.chainId = 97
		config.chainData = { chain: 'bsc-testnet', networkId: 97, chainId: 97 }
		break
	default:
		throw Error(`Unknown network ${config.blockChainName}`)
}

module.exports = config
