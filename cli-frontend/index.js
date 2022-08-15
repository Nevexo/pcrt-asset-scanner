const io = require('socket.io-client');

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
    console.log("WORK ORDER")
    console.dir(scan_data.work_order)
    console.log("PROCEEDE OPTIONS")
    console.dir(scan_data.options)
    console.log("--------------------")
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
}

console.log("PCRT-Scan - CLI frontend tool.")
main();