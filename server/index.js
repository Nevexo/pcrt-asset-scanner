// PCRT Scanner - Local WS Server
// Cameron Fleming / Triarom Ltd (c) 2022

const winston = require("winston");
const YAML = require('yaml')

const db = require("./database.js");
const scan = require("./scanner.js")

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp({
      format: "YYYY-MM-DD HH:mm:ss"
    }),
    winston.format.printf(info => `${info.timestamp} (${info.service}) ${info.level}: ${info.message}`)
  ),
  transports: [
    new winston.transports.Console()
  ],
  defaultMeta: {service: 'main'}
});

const main = async () => {
  logger.info("Starting PCRT Scanner Server")
  logger.debug("configuration load")

  // Fetching configuration from YAML file
  let config;
  try {
    config = YAML.parse(await require('fs').readFileSync('./config.yaml', 'utf8'))
  } catch (Error) {
    logger.error("Failed to load configuration")
    logger.error(Error)
    process.exit(1)
  }
  logger.debug("configuration loaded")

  // Bring up database
  logger.debug("database load")
  const database = new db.Database(logger, config);

  database.emitter.on("disconnected", () => {
    logger.error("Database disconnected")
  })

  logger.debug("connecting to database")
  await database.connect().catch((error) => {
    logger.error("Failed to connect to database on cold-start, this will cause a process exit.")
    logger.error(error)
    process.exit(1)
  });

  // Bring up Scanner SocketIO
  logger.debug("starting scanner socket server")
  const scanner = new scan.Scanner(logger, config);

  scanner.emitter.on("system_command", async (command) => {
    switch (command) {
      case "RECONNECT":
        logger.info("QRCommand: Reconnecting to database")
        await database.reconnect();
        break;
      case "DISCONNECT":
        logger.info("QRCommand: Disconnecting from database")
        await database.disconnect();
        break;
      case "SHUTDOWN":
        logger.info("QRCommand: Shutting down")
        database.disconnect();
        process.exit(0)
      default:
        logger.warn("QRCommand: Unknown command: " + command)
        break;
    }
  })
  
  scanner.emitter.on('barcode', async (code) => {
    const wo = await database.get_work_order(code);
    const cust = await database.get_customer(wo.pcid);

    console.log("Owner: " + cust.pcname);
    console.log("Problem: " + wo.probdesc);
    
  })

  logger.info("PCRT Scanner Server started")
  logger.info(`Listening for scanner agents on port ${config.ports.scanner_socket}`)
  logger.info(`Listening for client requests on port ${config.ports.client_socket}`)
}

// Invoke async entrypoint
main();