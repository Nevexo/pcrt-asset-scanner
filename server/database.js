// PCRT Scanner Tool - Server Database Interface

const events = require("events")
const mysql = require("promise-mysql");
const { disconnect } = require("process");

class Database {
  constructor(logger, config) {
    this.logger = logger.child({meta: {"service": "database"}});
    this.logger.debug("database invoked, loading");
    this.config = config;

    // Setup event emitters
    this.emitter = new events.EventEmitter();
  }

  async connect() {
    // Establish connection to database
    this.logger.debug(`Connecting to ${this.config.database.host} as ${this.config.database.user}`)
    this.connection = await mysql.createConnection({
      host: this.config.database.host,
      port: this.config.database.port,
      user: this.config.database.user,
      password: this.config.database.password,
      database: this.config.database.database
    }).catch(error => {
      this.logger.error(error)
    });

    this.connection.on("error", (error) => {
      this.logger.error(error)
    })

    this.connection.on("disconnect", async () => {
      this.logger.info("database connection lost.");
      this.emitter.emit("disconnected");

      await this.handle_disconnection();
    })

    this.logger.debug("connected to database.")
    return true;
  }

  async handle_disconnection() {
    this.logger.debug("restarting database connection")
    await this.connect();
  }

  async disconnect() {
    this.logger.info("disconnecting from database")
    this.connection.end();
  }

  async reconnect() {
    this.logger.info("reconnecting to database")
    await this.disconnect();
    await this.connect();
  }

  async get_work_order(woid) {
    // Get a work order from it's ID, as scanned by the scanner.
    this.logger.debug(`getting work order ${woid}`)
    const result = await this.connection.query(`SELECT * FROM pc_wo WHERE woid = ${mysql.escape(woid)}`);

    if (result.length == 0) {
      return "no_work_order";
    } else {
      return result[0];
    }
  }

  async get_customer(pcid) {
    // Get a customer from it's ID, usually from a work order.
    this.logger.debug(`getting customer ${pcid}`)
    const result = await this.connection.query(`SELECT * FROM pc_owner WHERE pcid = ${mysql.escape(pcid)}`)
    if (result.length == 0) {
      return "no_customer";
    } else {
      return result[0];
    }
  }
}

exports.Database = Database;