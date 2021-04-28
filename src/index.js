require('./env')

const watcher = require('./service/watcher')

watcher.executeTx(process.env.TX)
console.log('Service started')

process.on('uncaughtException', function(err) {
	// handle the error safely
	console.log(err)
})
