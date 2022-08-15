// PCRT Asset Scanner - Client/Frontend interaction module
// Triarom Engineering (c) 2022

// This creates another socket.io server for frontend/client instances to connect to.
// Multiple instances are allowed to connect to the client socket, and will recieve broadcasts about system changes.

const server = require('http').createServer();
const io = require('socket.io')(server);
const events = require("events")

class Client {
  constructor(logger, config) {
    this.logger = logger.child({meta: {"service": "frontend"}});
    this.logger.debug("frontend interface invoked, loading");
    this.config = config;

    // Setup event emitters
    this.emitter = new events.EventEmitter();

    // Start local server
    server.listen(this.config.ports.client_socket)

    // Handle socket.io connection
    io.on('connection', (socket) => {
      this.handle_connection(socket);
    });
  }

  async handle_connection(client) {
    this.logger.info("New frontend client has connected.")
    this.emitter.emit("client_connected");
    
    // TODO: Maybe send colour of statuses to client?
    client.emit("hello", {
      "api_version": 1, 
      "api_name": "pcrt_scanner",
      "connect_time": new Date().toISOString()
    });

    client.on('disconnect', () => {
      this.logger.info("Frontend client has disconnected")
      this.emitter.emit("client_disconnected");
    })
  }

  async broadcast_message(topic, message) {
    // Broadcast message to all connected clients.
    this.logger.debug("Broadcasting message to all clients: " + message.toString());
    io.emit(topic, message);
  }
}

exports.Client = Client;