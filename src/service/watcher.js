const Web3 = require('web3')
const abiDecoder = require('abi-decoder')
const config = require('../config')
const web3Http = new Web3(
	new Web3.providers.HttpProvider(process.env.NODE_API_URL)
)
const pairAbi = require('../abis/pair.json')
const erc20Abi = require('../abis/ERC20.json')
const routerAbi = require('../abis/uniswap-router-v2.json')
const BN = require('bignumber.js')
import UniswapService from './uniswapService'
const SDK = new UniswapService({})
const MAX_AMOUNT = new BN(process.env.MAX_AMOUNT)
const MIN_AMOUNT = new BN(process.env.MIN_AMOUNT)
const WETH_CONTRACT_ADDRESS = process.env.WETH_CONTRACT_ADDRESS.toLowerCase()
abiDecoder.addABI(routerAbi)
const { getLastTx } = require('./scannerService')

let lastTxHash = ''

async function watchEtherTransfers() {
	setInterval(checkForNewTransaction, 2000)
}

const checkForNewTransaction = async () => {
	const lastTx = await getLastTx(config.targetWallet)
	if (!lastTxHash) {
		lastTxHash = lastTx.hash
		return
	}
	if (lastTx.hash && lastTx.hash !== lastTxHash) {
		lastTxHash = lastTx.hash
		const txHash = lastTxHash
		console.log('got new tx:', txHash)
		processTransaction(lastTx).catch(console.log)
	}
}

const processTransaction = async ({ hash }) => {
	const trx = await getTxWithRepeat(20, hash)
	if (trx && trx.from.toLowerCase() === config.targetWallet) {
		console.log('New Transaction Found: ', hash)
		const data = trx.input
		const decodedData = abiDecoder.decodeMethod(data)
		if (decodedData) {
			if (config.followOnlySucceded) {
				confirmAndSendEtherTransaction(hash, 1, decodedData, trx, sendTx).catch(
					e => {
						throw e
					}
				)
			} else {
				await sendTx(decodedData, trx)
			}
		}
	}
}

const calculateAmount = (amount, decimals = 18) => {
	console.log(amount)
	amount = SDK.getNormalizedNumber(amount, decimals)
	if (amount.isGreaterThanOrEqualTo(MAX_AMOUNT)) {
		return MAX_AMOUNT.toNumber()
	} else if (amount.isLessThanOrEqualTo(MIN_AMOUNT)) {
		return 0
	}

	return amount.toNumber()
}

async function sendTx(decodedData, trx) {
	try {
		let path = decodedData.params.filter(el => el.name === 'path')[0].value
		let method = null

		const swapParams = {
			fromPublicKey: config.mainWallet,
			fromPrivateKey: config.mainWalletKey,
			outPublicKey: config.mainWallet,
			amount: 0,
			contractAddress: config.routerAddress,
			tokenIn: path[0].toLowerCase(),
			tokenOut: path[path.length - 1].toLowerCase(),
		}
		switch (decodedData.name) {
			case 'swapExactETHForTokens':
				swapParams.tokenIn = config.wethContract
				swapParams.amount = calculateAmount(trx.value)
				method = 'createTransactionExactTokenToToken'
				break
			case 'swapExactTokensForETH':
				swapParams.tokenOut = config.wethContract
				swapParams.amount = calculateAmount(
					decodedData.params.filter(el => el.name === 'amountOutMin')[0].value
				)
				method = 'createTransactionTokensForExactETH'
				break
			case 'swapExactTokensForTokens':
				if (swapParams.tokenIn === config.wethContract) {
					swapParams.amount = calculateAmount(
						decodedData.params.filter(el => el.name === 'amountIn')[0].value
					)
					method = 'createTransactionExactTokenToToken'
					break
				}
				if (swapParams.tokenOut === config.wethContract) {
					swapParams.amount = calculateAmount(
						decodedData.params.filter(el => el.name === 'amountOutMin')[0].value
					)
					method = 'createTransactionTokensForExactETH'
					break
				}
				break
			case 'swapTokensForExactTokens':
				if (swapParams.tokenIn === config.wethContract) {
					swapParams.amount = calculateAmount(
						decodedData.params.filter(el => el.name === 'amountIn')[0].value
					)
					method = 'createTransactionExactTokenToToken'
					break
				}
				if (swapParams.tokenOut === config.wethContract) {
					swapParams.amount = calculateAmount(
						decodedData.params.filter(el => el.name === 'amountOutMin')[0].value
					)
					method = 'createTransactionTokensForExactETH'
					break
				}
				break
			case 'swapTokensForExactETH':
				swapParams.tokenOut = config.wethContract
				swapParams.amount = calculateAmount(
					decodedData.params.filter(el => el.name === 'amountOutMin')[0].value
				)
				method = 'createTransactionTokensForExactETH'
				break
			case 'swapETHForExactTokens':
				swapParams.amount = calculateAmount(
					decodedData.params.filter(el => el.name === 'amountIn')[0].value
				)
				method = 'createTransactionExactTokenToToken'
				break
		}

		if (!swapParams.amount) {
			console.log('amount too small')
			return
		}

		if (swapParams.tokenIn === config.wethContract) {
			if (config.stopBuying) {
				console.log('the bot is restricted form buying')
				return
			}
			console.log('Bot Buys')
		} else if (swapParams.tokenOut === config.wethContract) {
			if (config.stopSelling) {
				console.log('the bot is restricted form selling')
				return
			}
			console.log('Bot Sells')
		} else {
			console.log('Not an WETH or ETH swap, skipping')
			return
		}
		if (!method) {
			console.log(`${decodedData.name} method not implemented yet`)
			return
		}

		const result = await SDK[method](swapParams)

		console.log('Result: ', result)
	} catch (error) {
		console.log(error)
	}
}

async function getConfirmations(txHash) {
	try {
		// Get transaction details
		const trx = await web3Http.eth.getTransaction(txHash)

		// Get current block number
		const currentBlock = await web3Http.eth.getBlockNumber()

		// When transaction is unconfirmed, its block number is null.
		// In this case we return 0 as number of confirmations
		if (trx === null || trx.blockNumber === null) {
			return 0
		}
		return currentBlock - trx.blockNumber
	} catch (error) {
		console.log(error)
	}
}

async function confirmAndSendEtherTransaction(
	txHash,
	confirmations = 1,
	decodedData,
	trx,
	callback
) {
	// Get current number of confirmations and compare it with sought-for value
	const trxConfirmations = await getConfirmations(txHash)
	// console.log('Transaction with hash ' + txHash + ' has ' + trxConfirmations + ' confirmation(s)')
	if (trxConfirmations >= confirmations) {
		// Handle confirmation event according to your business logic
		console.log(
			'Transaction with hash ' + txHash + ' has been successfully confirmed'
		)
		await callback(decodedData, trx)
	} else {
		setTimeout(async () => {
			confirmAndSendEtherTransaction(
				txHash,
				confirmations,
				decodedData,
				trx,
				callback
			).catch(e => {
				throw e
			})
		}, 30 * 1000)
	}
}

const swapTopic =
	'0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'
async function decodeSwap(txReceipt) {
	let logs = txReceipt.logs
	if (logs && logs.length > 0) {
		let swapLogs = logs.filter(el => el.topics.includes(swapTopic))
		if (swapLogs.length > 0) {
			for (let swapLog of swapLogs) {
				let swapEvent = web3Http.eth.abi.decodeLog(
					[
						{
							indexed: true,
							internalType: 'address',
							name: 'sender',
							type: 'address',
						},
						{
							indexed: false,
							internalType: 'uint256',
							name: 'amount0In',
							type: 'uint256',
						},
						{
							indexed: false,
							internalType: 'uint256',
							name: 'amount1In',
							type: 'uint256',
						},
						{
							indexed: false,
							internalType: 'uint256',
							name: 'amount0Out',
							type: 'uint256',
						},
						{
							indexed: false,
							internalType: 'uint256',
							name: 'amount1Out',
							type: 'uint256',
						},
						{
							indexed: true,
							internalType: 'address',
							name: 'to',
							type: 'address',
						},
					],
					swapLog.data,
					swapLog.topics.slice(1, swapLog.topics.length)
				)
				// console.log('Swap Log Address: ', swapLog.address)

				const poolContract = new web3Http.eth.Contract(pairAbi, swapLog.address)
				const token0 = await poolContract.methods.token0().call()
				const token1 = await poolContract.methods.token1().call()
				const token0Contract = new web3Http.eth.Contract(erc20Abi, token0)
				const token1Contract = new web3Http.eth.Contract(erc20Abi, token1)
				const token0decimals = await token0Contract.methods.decimals().call()
				const token1decimals = await token1Contract.methods.decimals().call()
				const token0Sym = await token0Contract.methods.symbol().call()
				const token1Sym = await token1Contract.methods.symbol().call()
				const amount0In = swapEvent.amount0In
				const amount0Out = swapEvent.amount0Out
				const amount1In = swapEvent.amount1In
				const amount1Out = swapEvent.amount1Out
				if (amount0In > 0) {
					if (amount1Out > 0) {
						const amount0 = getNormalizedNumber(
							amount0In,
							token0decimals
						).toFixed(4)
						const amount1 = getNormalizedNumber(
							amount1Out,
							token1decimals
						).toFixed(4)
						console.log(
							'New Swap! ',
							amount0,
							' ',
							token0Sym,
							' -> ',
							amount1,
							' ',
							token1Sym
						)
						if (
							token0.toLowerCase() === WETH_CONTRACT_ADDRESS ||
							token1.toLowerCase() === WETH_CONTRACT_ADDRESS
						) {
							console.log('Executing Transation')
							await createTransaction(
								token0Sym,
								token1Sym,
								amount0,
								amount1,
								token0,
								token1
							)
						}
					}
				}
				if (amount1In > 0) {
					if (amount0Out > 0) {
						const amount1 = getNormalizedNumber(
							amount1In,
							token1decimals
						).toFixed(4)
						const amount0 = getNormalizedNumber(
							amount0Out,
							token0decimals
						).toFixed(4)
						console.log(
							'New Swap! ',
							amount1,
							' ',
							token1Sym,
							' -> ',
							amount0,
							' ',
							token0Sym
						)
						if (
							token0.toLowerCase() === WETH_CONTRACT_ADDRESS ||
							token1.toLowerCase() === WETH_CONTRACT_ADDRESS
						) {
							console.log('Executing Transation')
							await createTransaction(
								token0Sym,
								token1Sym,
								amount0,
								amount1,
								token0,
								token1
							)
						}
					}
				}
				// console.log('token0 address: ', token0 )
				// console.log('token1 address: ', token1 )
				// console.log('New Swap! ', swapEvent)
			}
		}
	}
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

const getTxWithRepeat = async (repeatTimes, hash) => {
	let res
	for (let i = 0; i < repeatTimes; i++) {
		res = await web3Http.eth.getTransaction(hash)
		if (i) {
			console.log(i)
		}
		if (res) {
			return res
		}
		await delay(500)
	}
	return res
}

function getNormalizedNumber(number, decimals) {
	return new BN(number).dividedBy(new BN(10).pow(decimals))
}

async function createTransaction(
	token0Sym,
	token1Sym,
	amount0,
	amount1,
	token0Address,
	token1Address
) {
	try {
		if (token0Address.toLowerCase() === WETH_CONTRACT_ADDRESS) {
			switch (amount0) {
				case amount0 > MAX_AMOUNT:
					SDK.createTransactionExactTokenToToken(
						process.env.WALLET_FROM,
						process.env.PRIVATE_KEY,
						process.env.WALLET_FROM,
						amount0,
						process.env.ROUTER_ADDRESS,
						token0Address,
						token1Address
					)
						.then(hash => console.log('Transaction success: ', hash))
						.catch(error => console.log(error))
					break
				case amount0 > MIN_AMOUNT && amount0 < MAX_AMOUNT:
					SDK.createTransactionExactTokenToToken(
						process.env.WALLET_FROM,
						process.env.PRIVATE_KEY,
						process.env.WALLET_FROM,
						amount0,
						process.env.ROUTER_ADDRESS,
						token0Address,
						token1Address
					)
						.then(hash =>
							console.log('BOT TX EXECUTED: ', token0Sym, ' -> ', token1Sym)
						)
						.catch(error => console.log(error))
					break
			}
		}
		if (token1Address.toLowerCase() === WETH_CONTRACT_ADDRESS) {
			switch (amount1) {
				case amount1 > MAX_AMOUNT:
					// sell all tokens
					SDK.createTransactionExactTokenToToken(
						process.env.WALLET_FROM,
						process.env.WALLET_FROM_PRIVATE_KEY,
						process.env.WALLET_FROM,
						MAX_AMOUNT,
						process.env.ROUTER_ADDRESS,
						token1Address,
						token0Address
					)
						.then(hash => console.log('Transaction success: ', hash))
						.catch(error => console.log(error))
					break
				case amount1 > MIN_AMOUNT && amount1 < MAX_AMOUNT:
					SDK.createTransactionExactTokenToToken(
						process.env.WALLET_FROM,
						process.env.WALLET_FROM_PRIVATE_KEY,
						process.env.WALLET_FROM,
						amount1,
						process.env.ROUTER_ADDRESS,
						token1Address,
						token0Address
					)
						.then(hash => console.log('Transaction success: ', hash))
						.catch(error => console.log(error))
					break
			}
		}
	} catch (error) {
		console.log(error)
	}
}

module.exports = {
	watchEtherTransfers,
	processTransaction,
}
