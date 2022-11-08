// PCRT COM Scanner Agent
// This is a temporary implementation.

const io = require('socket.io-client');

const main = async () => {
  const args = process.argv.slice(2);
  if (args.length == 0) {
    console.error("no ID provided")
    return process.exit(1);
  }

  const id = args[0];
  console.log("will present " + id + " to server.")

  const socket = await io("http://localhost:3000");
  socket.on('connect', async () => {
    console.log('connected');
    console.log('waiting to send barcode...');
    setTimeout(async () => {
        console.log('send barcode')
        await socket.emit('barcode', args[0].toString());
    }, 1000);
    console.log("strike ^c to end")
  })

  socket.on('event', (data) => {
    console.log(data);
  })

  socket.on('error', (error) => {
    console.log(error);
  })

  socket.on('disconnect', () => {
    console.log('disconnected - done.');
  })
};

main();