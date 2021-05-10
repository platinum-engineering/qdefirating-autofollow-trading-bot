const axios = require('axios')
const { chainScannerApiUrl, chainScannerApiKey } = require('../config').apis

const getAllTx = async address => {
	const scannerUrl = `${chainScannerApiUrl}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=desc&apikey=${chainScannerApiKey}`
	const res = await axios.get(scannerUrl)

	return res.data.result
}

const getLastTx = async address => {
	const txs = await getAllTx(address)
	return txs[0]
}

module.exports = {
	getAllTx,
	getLastTx,
}
