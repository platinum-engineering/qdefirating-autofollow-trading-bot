const { ChainId } = require('@uniswap/sdk')

const config = {
	blockChainName: process.env.BLOCKCHAIN_NAME,
	apis: {
		nodeApiUrl: process.env.NODE_API_URL,
		nodeApiWsUrl: process.env.NODE_API_WS_URL,
		chainScannerApiUrl: process.env.CHAIN_SCANER_API_URL,
		chainScannerApiKey: process.env.CHAIN_SCANER_API_KEY,
	},
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
