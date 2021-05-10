const config = require('../config')
const Web3 = require('web3')
const abiJson = require('../abis/uniswap-router-v2.json')
const abiERC20 = require('../abis/ERC20.json')
const abiPair = require('../abis/pair.json')
const BigNumber = require('bignumber.js')
const Tx = require('ethereumjs-tx').Transaction
const util = require('ethereumjs-util')
const uniSDK = require('@uniswap/sdk')
const WETH = uniSDK.WETH
const Token = uniSDK.Token
const Percent = uniSDK.Percent
const Fetcher = uniSDK.Fetcher
const Trade = uniSDK.Trade
const Route = uniSDK.Route
const TokenAmount = uniSDK.TokenAmount
const TradeType = uniSDK.TradeType
const Pair = uniSDK.Pair
const chainID = config.chainId

export default class UniswapService {
	constructor(exchangeData) {
		this.info = exchangeData
		this.tokenContract = {}
		this.web3 = new Web3(
			new Web3.providers.HttpProvider(config.apis.nodeApiUrl)
		)
	}

	getNormalizedNumber(number, decimals) {
		return new BigNumber(number).dividedBy(new BigNumber(10).pow(decimals))
	}

	async createOrder(_robot, data) {
		try {
			const robotData = this.info.settings.keys.filter(
				robot => robot._robot === _robot
			)[0]
			const publicKey = robotData.publicKey.replace(/\s+/g, '')
			const privateKey = robotData.privateKey.replace(/\s+/g, '')
			const outPublicKey = robotData.outPublicKey.replace(/\s+/g, '')
			const tokenIn = robotData.tokenIn.replace(/\s+/g, '')
			const tokenOut = robotData.tokenOut.replace(/\s+/g, '')
			const contractAddress = robotData.contractAddress.replace(/\s+/g, '')
			const orderCreated = await this.createTransactionExactTokenToToken(
				publicKey,
				privateKey,
				outPublicKey,
				data.amount,
				contractAddress,
				tokenIn,
				tokenOut
			)
			return {
				orderId: orderCreated,
				createdAt: new Date(),
			}
		} catch (error) {
			if (error.response) {
				if (error.response.data.errors) {
					throw new Error(error.response.data.errors[0].message)
				} else {
					throw new Error(error.response.data)
				}
			} else {
				throw error
			}
		}
	}

	async prepareTransactionExactTokenToToken(
		fromPublicKey,
		fromPrivateKey,
		outPublicKey,
		coinAmount,
		contractAddress,
		tokenIn,
		tokenOut
	) {
		try {
			const resultTransactionCount = await this.web3.eth.getTransactionCount(
				fromPublicKey,
				'pending'
			)
			const transaction = {
				from: fromPublicKey,
				to: contractAddress,
				nonce: this.web3.utils.toHex(resultTransactionCount),
			}
			tokenIn = this.web3.utils.toChecksumAddress(tokenIn, chainID)
			tokenOut = this.web3.utils.toChecksumAddress(tokenOut, chainID)
			const contract = new this.web3.eth.Contract(abiJson, contractAddress, {
				from: fromPublicKey,
			})
			const tokenInContract = new this.web3.eth.Contract(abiERC20, tokenIn)
			const tokenOutContract = new this.web3.eth.Contract(abiERC20, tokenOut)
			const tokenInDecimals = await tokenInContract.methods.decimals().call()
			const tokenOutDecimals = await tokenOutContract.methods.decimals().call()
			const tokenInInit = new Token(chainID, tokenIn, tokenInDecimals)
			const tokenOutInit = new Token(chainID, tokenOut, tokenOutDecimals)
			const pair = await this.getPair(tokenInInit, tokenOutInit)
			const route = new Route([pair], tokenInInit)
			const trade = new Trade(
				route,
				new TokenAmount(
					tokenInInit,
					new BigNumber(coinAmount).multipliedBy(
						new BigNumber(10).pow(tokenInDecimals)
					)
				),
				TradeType.EXACT_INPUT
			)
			const slippageTolerance = new Percent('500', '10000')
			const amountOutMin = this.getNormalizedNumber(
				trade.minimumAmountOut(slippageTolerance).raw,
				tokenOutDecimals
			)

			const path = [tokenInInit.address, tokenOutInit.address]
			const deadline = Math.floor(Date.now() / 1000) + 60 * 20
			const value = this.getNormalizedNumber(
				trade.inputAmount.raw,
				tokenInDecimals
			)
			// check balance
			const hasGotEnoughBalance = await this.hasGotEnoughBalanceEth(
				coinAmount,
				fromPublicKey
			)
			if (!hasGotEnoughBalance) {
				console.log('Bot has got insufficient amount of tokens in balance')
				return
			}
			if (tokenIn.toLowerCase() === WETH[chainID].address.toLowerCase()) {
				transaction.value = this.web3.utils.toHex(
					value.multipliedBy(new BigNumber(10).pow(tokenInDecimals)).toFixed()
				)
				transaction.data = contract.methods
					.swapExactETHForTokens(
						this.web3.utils.toHex(
							amountOutMin
								.multipliedBy(new BigNumber(10).pow(tokenOutDecimals))
								.toFixed()
						),
						path,
						outPublicKey,
						deadline
					)
					.encodeABI()
			} else if (
				tokenOut.toLowerCase() === WETH[chainID].address.toLowerCase()
			) {
				// console.log('ERC20 ----> ETH Transaction')
				transaction.data = contract.methods
					.swapExactTokensForETH(
						this.web3.utils.toHex(
							value
								.multipliedBy(new BigNumber(10).pow(tokenInDecimals))
								.toFixed()
						),
						this.web3.utils.toHex(
							amountOutMin
								.multipliedBy(new BigNumber(10).pow(tokenOutDecimals))
								.toFixed()
						),
						path,
						outPublicKey,
						deadline
					)
					.encodeABI()
			} else {
				// console.log('ERC20 ----> ERC20 Transaction')
				transaction.data = contract.methods
					.swapExactTokensForTokens(
						this.web3.utils.toHex(
							value
								.multipliedBy(new BigNumber(10).pow(tokenInDecimals))
								.toFixed()
						),
						this.web3.utils.toHex(
							amountOutMin
								.multipliedBy(new BigNumber(10).pow(tokenOutDecimals))
								.toFixed()
						),
						path,
						outPublicKey,
						deadline
					)
					.encodeABI()
			}

			const gasLimit = await this.web3.eth.estimateGas({ ...transaction })
			const gasPriceWei = await this.web3.eth.getGasPrice()
			transaction.gasPrice = this.web3.utils.toHex(gasPriceWei.toString())
			transaction.gasLimit = this.web3.utils.toHex(gasLimit.toString())
			return { ...transaction }
		} catch (error) {
			console.log(error)
		}
	}

	async prepareTransactionTokensForExactETH(
		fromPublicKey,
		fromPrivateKey,
		outPublicKey,
		amountETH,
		contractAddress,
		tokenIn,
		tokenOut
	) {
		try {
			const resultTransactionCount = await this.web3.eth.getTransactionCount(
				fromPublicKey,
				'pending'
			)
			const transaction = {
				from: fromPublicKey,
				to: contractAddress,
				nonce: this.web3.utils.toHex(resultTransactionCount),
			}

			const contract = new this.web3.eth.Contract(abiJson, contractAddress, {
				from: fromPublicKey,
			})
			tokenIn = this.web3.utils.toChecksumAddress(tokenIn, chainID)
			tokenOut = this.web3.utils.toChecksumAddress(tokenOut, chainID)
			const tokenInContract = new this.web3.eth.Contract(abiERC20, tokenIn)
			const tokenInDecimals = await tokenInContract.methods.decimals().call()
			const tokenOutDecimals = 18

			const tokenInInit = new Token(chainID, tokenIn, tokenInDecimals)
			const tokenOutInit = new Token(chainID, tokenOut, tokenOutDecimals)

			const pair = await this.getPair(tokenInInit, tokenOutInit)
			const route = new Route([pair], tokenInInit)
			const trade = new Trade(
				route,
				new TokenAmount(
					tokenOutInit,
					new BigNumber(amountETH)
						.multipliedBy(new BigNumber(10).pow(tokenOutDecimals))
						.toFixed()
				),
				TradeType.EXACT_OUTPUT
			)
			const slippageTolerance = new Percent('500', '10000')
			const amountInMax = this.getNormalizedNumber(
				trade.maximumAmountIn(slippageTolerance).raw,
				tokenInDecimals
			)
			// approve token
			const approve = await this.approveToken(
				amountInMax,
				fromPublicKey,
				fromPrivateKey,
				tokenIn,
				tokenOut
			)
			if (!approve) {
				return
			}
			const hasEnoughBalance = await this.hasGotEnoughBalanceErc20(
				amountInMax,
				fromPublicKey
			)
			if (!hasEnoughBalance) {
				console.log('Bot has got insufficient amount of tokens in balance')
				return
			}
			const path = [tokenInInit.address, tokenOutInit.address]
			const deadline = Math.floor(Date.now() / 1000) + 60 * 20
			const value = this.getNormalizedNumber(
				trade.outputAmount.raw,
				tokenOutDecimals
			)
			transaction.data = contract.methods
				.swapTokensForExactETH(
					this.web3.utils.toHex(
						value
							.multipliedBy(new BigNumber(10).pow(tokenOutDecimals))
							.toFixed()
					),
					this.web3.utils.toHex(
						amountInMax
							.multipliedBy(new BigNumber(10).pow(tokenInDecimals))
							.toFixed()
					),
					path,
					outPublicKey,
					deadline
				)
				.encodeABI()
			const gasLimit = await this.web3.eth.estimateGas({ ...transaction })
			const gasPriceWei = await this.web3.eth.getGasPrice()
			transaction.gasPrice = this.web3.utils.toHex(gasPriceWei.toString())
			transaction.gasLimit = this.web3.utils.toHex(gasLimit.toString())
			return { ...transaction }
		} catch (error) {
			console.log(error)
		}
	}

	async createTransactionExactTokenToToken({
		fromPublicKey,
		fromPrivateKey,
		outPublicKey,
		amount,
		contractAddress,
		tokenIn,
		tokenOut,
	}) {
		try {
			this.tokenContract = new this.web3.eth.Contract(abiERC20, tokenIn)
			const rawTransaction = await this.prepareTransactionExactTokenToToken(
				fromPublicKey,
				fromPrivateKey,
				outPublicKey,
				amount,
				contractAddress,
				tokenIn,
				tokenOut
			)
			if (!rawTransaction) {
				return
			}
			const privateKey = new Buffer.from(fromPrivateKey, 'hex')
			const transaction = new Tx(rawTransaction, config.chainData)
			transaction.sign(privateKey)
			const serializedTx = transaction.serialize().toString('hex')
			this.web3.eth.sendSignedTransaction(
				'0x' + serializedTx,
				(error, hash) => {
					if (error) {
						console.log(error)
					}
				}
			)
			return util.bufferToHex(transaction.hash(true))
		} catch (error) {
			console.log(error)
		}
	}

	async createTransactionTokensForExactETH({
		fromPublicKey,
		fromPrivateKey,
		outPublicKey,
		amount,
		contractAddress,
		tokenIn,
		tokenOut,
	}) {
		try {
			this.tokenContract = new this.web3.eth.Contract(abiERC20, tokenIn)
			const rawTransaction = await this.prepareTransactionTokensForExactETH(
				fromPublicKey,
				fromPrivateKey,
				outPublicKey,
				amount,
				contractAddress,
				tokenIn,
				tokenOut
			)
			if (!rawTransaction) {
				return
			}
			const privateKey = new Buffer.from(fromPrivateKey, 'hex')
			const transaction = new Tx(rawTransaction, config.chainData)
			transaction.sign(privateKey)
			const serializedTx = transaction.serialize().toString('hex')
			this.web3.eth.sendSignedTransaction(
				'0x' + serializedTx,
				(error, hash) => {
					if (error) {
						console.log(error)
					}
				}
			)
			return util.bufferToHex(transaction.hash(true))
		} catch (error) {
			console.log(error)
		}
	}

	async getCurrentPrice(contractAddress) {
		try {
			const TOKEN = new Token(chainID, contractAddress, 18)
			const pair = await Fetcher.fetchPairData(TOKEN, WETH[TOKEN.chainId])
			const route = new Route([pair], WETH[TOKEN.chainId])
			const trade = new Trade(
				route,
				new TokenAmount(WETH[TOKEN.chainId], '1000000000000000000'),
				TradeType.EXACT_INPUT
			)
			// midPrice: Number(route.midPrice.toSignificant(6)),
			// executionPrice: Number(trade.executionPrice.toSignificant(6)),
			// nextMidPrice: Number(trade.nextMidPrice.toSignificant(6))
			return Number(route.midPrice.invert().toSignificant(6))
		} catch (error) {
			console.log(error)
			// throw error
		}
	}

	async getTickerPrice(contractAddress) {
		const currentPrice = await this.getCurrentPrice(contractAddress)
		return currentPrice
	}

	subscribeTickerPrice(symbol, ws, event, _exchange, _symbol, currentData) {
		if (currentData) {
			ws.send(
				JSON.stringify({
					bidPrice: currentData.price.tickerPrice,
					askPrice: currentData.price.tickerPrice,
					_exchange: _exchange._id.toString(),
					_symbol: _symbol._id.toString(),
				})
			)
		} else {
			ws.send(
				JSON.stringify({
					error: 'Price not found',
				})
			)
		}
		event.on('quoteWs', function(data) {
			if (
				data._exchange.toString() === _exchange._id.toString() &&
				data._symbol.toString() === _symbol._id.toString()
			) {
				ws.send(
					JSON.stringify({
						bidPrice: data.price.tickerPrice,
						askPrice: data.price.tickerPrice,
						_exchange: _exchange._id.toString(),
						_symbol: _symbol._id.toString(),
					})
				)
			}
		})
	}

	async initTokenContract(address) {
		this.tokenContract = new this.web3.eth.Contract(abiERC20, address)
	}

	async getTokenDecimals() {
		const decimals = await this.tokenContract.methods.decimals().call()
	}

	async getBalanceOf(userAddress) {
		const balance = await this.tokenContract.methods
			.balanceOf(userAddress)
			.call()
		return balance
	}

	async getAllowance(userAddress) {
		const allowance = await this.tokenContract.methods
			.allowance(userAddress, process.env.ROUTER_ADDRESS)
			.call()
		return allowance
	}

	async getTotalSupply(userAddress) {
		const totalSupply = await this.tokenContract.methods.totalSupply().call()
		return totalSupply
	}

	async getBalanceETH(userAddress) {
		return await this.web3.eth.getBalance(userAddress)
	}

	/**
	 * Generate the from token approve data max allowance to move the tokens.
	 * This will return the data for you to send as a transaction
	 */

	async generateApproveMaxAllowanceData(ethereumAddress, tokenAddress) {
		const data = this.tokenContract.methods
			.approve(
				process.env.ROUTER_ADDRESS,
				'0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
			)
			.encodeABI()
		// console.log('allowance data: ', data)
		return {
			to: tokenAddress,
			from: ethereumAddress,
			data,
			value: '0x00',
			// gasPrice: this.web3.utils.toHex(gasPriceWei.toString()),
			// gasLimit: this.web3.utils.toHex(gasLimit.toString())
		}
	}

	async approveToken(amount, fromPublicKey, fromPrivateKey, tokenIn, tokenOut) {
		// check allowance and balance
		const tradePath = this.getTradePath(tokenIn, tokenOut)
		// console.log('trade path: ', tradePath)
		if (tradePath === 'erc20-erc20' || tradePath === 'erc20-eth') {
			//check allowance
			if (!(await this.hasGotEnoughAllowance(amount, fromPublicKey))) {
				const resultTransactionCount = await this.web3.eth.getTransactionCount(
					fromPublicKey,
					'pending'
				)
				const rawTransaction = await this.generateApproveMaxAllowanceData(
					fromPublicKey,
					tokenIn
				)
				rawTransaction.nonce = this.web3.utils.toHex(resultTransactionCount)
				const gasLimit = await this.web3.eth.estimateGas({ ...rawTransaction })
				const gasPriceWei = await this.web3.eth.getGasPrice()
				rawTransaction.gasPrice = this.web3.utils.toHex(gasPriceWei.toString())
				rawTransaction.gasLimit = this.web3.utils.toHex(gasLimit.toString())
				const privateKey = new Buffer.from(fromPrivateKey, 'hex')
				const transaction = new Tx(rawTransaction, config.chainData)
				transaction.sign(privateKey)
				const serializedTx = transaction.serialize().toString('hex')
				this.web3.eth.sendSignedTransaction(
					'0x' + serializedTx,
					(error, hash) => {
						console.log(error, hash)
						if (error) {
							return false
						}
						return true
					}
				)
			}
			return true
		}
		return true
	}

	async hasGotEnoughAllowance(amount, userAddress) {
		const decimals = await this.tokenContract.methods.decimals().call()
		const allowance = this.getNormalizedNumber(
			await this.getAllowance(userAddress),
			decimals
		)
		if (new BigNumber(amount).isGreaterThan(allowance)) {
			return false
		}
		return true
	}

	async hasGotEnoughBalanceErc20(amount, userAddress) {
		const decimals = await this.tokenContract.methods.decimals().call()
		const balance = await this.tokenContract.methods
			.balanceOf(userAddress)
			.call()
		if (
			new BigNumber(amount).isGreaterThan(
				this.getNormalizedNumber(balance, decimals)
			)
		) {
			return false
		}
		return true
	}

	async hasGotEnoughBalanceEth(amount, userAddress) {
		const result = await this.web3.eth.getBalance(userAddress)
		const balance = this.getNormalizedNumber(result, 18)
		if (new BigNumber(amount).isGreaterThan(balance)) {
			return false
		}
		return true
	}

	getTradePath(fromToken, toToken) {
		if (fromToken.toLowerCase() === WETH[chainID].address.toLowerCase()) {
			return 'eth-erc20'
		} else if (toToken.toLowerCase() === WETH[chainID].address.toLowerCase()) {
			return 'erc20-eth'
		} else {
			return 'erc20-erc20'
		}
	}

	async getPair(tokenIn, tokenOut) {
		const pairAddress = Pair.getAddress(tokenIn, tokenOut)
		const pairContract = new this.web3.eth.Contract(abiPair, pairAddress)
		const reserves = await pairContract.methods.getReserves().call()
		const reserve0 = reserves._reserve0
		const reserve1 = reserves._reserve1

		const tokens = [tokenIn, tokenOut]
		const [token0, token1] = tokens[0].sortsBefore(tokens[1])
			? tokens
			: [tokens[1], tokens[0]]

		const pair = new Pair(
			new TokenAmount(token0, reserve0),
			new TokenAmount(token1, reserve1)
		)
		return pair
	}
}
