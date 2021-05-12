require('./env')

const watcher = require('./service/watcher')
if (process.env.NODE_ENV !== 'dev') {
	console.error('Run only in dev environment')
	process.exit(-1)
}
const txHash = process.argv[2]
if (!txHash) {
	console.error('Usage: npm run copy transaction_hash')
	process.exit(-2)
}

watcher.processTransaction({ hash: txHash })
console.log('Service started')

process.on('uncaughtException', function(err) {
	// handle the error safely
	console.log(err)
})
