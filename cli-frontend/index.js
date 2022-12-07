const io = require('socket.io-client');
const util = require('util');

const main = async () => {
  const socket = await io("http://localhost:3500");
  
  socket.on('connect', () => {
    console.log('connected');
  })

  socket.on('hello', (data) => {
    console.log("hello sent, configuration data:")
    console.dir(data)
  })

  socket.on('scan', (scan_data) => {
    console.log("---- SCAN DATA ----")
    console.log(util.inspect(scan_data, {showHidden: false, depth: null, colors: true}))
    console.log("--------------------")
  })

  socket.on('busy', (message) => {
    console.log(`BUSY MESSAGE: ${message}`)
  })

  socket.on('server_error', (error) => {
    console.log(`---- SERVER ERROR ----`)
    console.dir(error)
    console.log("--------------------")
  })

  socket.on('info', (message) => {
    console.log(`---- INFO ----`)
    console.log(message.type)
    console.log(message.message)
    console.log("--------------------")
  })

  socket.on('storage_state', (bays) => {
    console.log(`---- STORAGE STATE ----`)
    console.dir(bays)
    for (const bay in bays) {
      if (bays[bay].work_order == undefined) continue;
      console.dir(bays[bay].work_order.location)
    }
    console.log("--------------------")
  })
}

console.log("PCRT-Scan - CLI frontend tool.")
main();