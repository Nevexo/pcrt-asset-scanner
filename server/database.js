// PCRT Scanner Tool - Server Database Interface

const events = require("events")
const mysql = require("promise-mysql");

class Database {
  constructor(logger, config) {
    this.logger = logger.child({meta: {"service": "database"}});
    this.logger.debug("database invoked, loading");
    this.config = config;

    // Setup event emitters
    this.emitter = new events.EventEmitter();
  }

  async clear_caches() {
    this.logger.info("Clearing location/state caches.")
    this.storage_location_cache = undefined;
    this.asset_status_cache = undefined;
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

  async get_storage_locations() {
    // Get all possible storage locations, this is from the
    // storagelocations table.
    if (this.storage_location_cache) return this.storage_location_cache;
    this.logger.debug("getting storage locations")

    const result = await this.connection.query(`SELECT * FROM storagelocations`)

    if (result.length == 0) {
      this.logger.erorr("FATAL: No storage locations found, ensure they are created in PCRT!")
      this.logger.error("This error is fatal, exiting.")
      process.exit(1)
    }

    let locations = {}
    for (let bay in result) {
      bay = result[bay]
      locations[bay.bayid] = {
        "id": bay.slid,
        "name": bay.slname
      }
    }
    
    this.storage_location_cache = locations;
    return locations;
  }

  async get_asset_states() {
    // Get all possible states for devices, this is from the
    // boxstyles table.
    if (this.asset_status_cache) return this.asset_status_cache;
    this.logger.debug("getting asset states")
    const result = await this.connection.query(`SELECT * FROM boxstyles`)
    
    let states = {};
    for (let state in result) {
      state = result[state]

      states[state.statusid] = {
        "id": state.statusid,
        "name": state.boxtitle,
        "pcrt_scan_state": this.config['states'][state.statusid] || undefined,
        "colour": state.selectorcolor
      }
    }

    this.asset_status_cache = states;
    return states;
  }

  async format_work_order(wo) {
    const states = await this.get_asset_states();

    let work_order = {
      "id": wo.woid,
      "customer": await this.get_customer(wo.pcid),
      "problem": wo.probdesc,
      "status": states[wo.pcstatus.toString()] || wo.pcstatus || undefined,
      "open_date": new Date(wo.dropdate).toISOString(),
      "location": this.get_storage_locations()[wo.bayid] || undefined,
    }
    return work_order
  }

  async get_work_order(woid) {
    // Get a work order from it's ID, as scanned by the scanner.
    this.logger.debug(`getting work order ${woid}`)
    const result = await this.connection.query(`SELECT * FROM pc_wo WHERE woid = ${mysql.escape(woid)}`);

    if (result.length == 0) {
      throw new Error(`invalid_work_order`);
    }
    
    this.logger.debug(`found work order ${woid} - PCID: ${result[0].pcid}`)
    
    const wo = result[0];

    const work_order = this.format_work_order(wo);

    return work_order;
  }

  async get_work_order_by_status(status) {
    // Get all currently open work orders from their status ID
    this.logger.debug(`getting work orders by status ${status}`)

    const result = await this.connection.query(`SELECT * FROM pc_wo WHERE pcstatus = ${mysql.escape(status)}`)

    let work_orders = [];
    for (let wo in result) {
      result.push(this.format_work_order(result[wo]))
    }

    return work_orders
  }

  async get_open_work_orders() {
    // Get all non-collected work orders
    this.logger.debug("getting open work orders")

    // Find status ID for all closed jobs
    let closed_state = undefined;
    for (const state in this.config.states) {
      if (this.config.states[state].name == "collected") closed_state = state;
    }

    if (!closed_state) {
      this.logger.error("FATAL: No closed state found, ensure it is created in PCRT!")
      this.logger.error("This error is fatal, exiting.")
      process.exit(1)
    }

    const result = await this.connection.query(`SELECT * FROM pc_wo WHERE pcstatus != ${closed_state}`)

    let work_orders = [];
    for (let wo in result) {
      work_orders.push(await this.format_work_order(result[wo]))
    }

    return work_orders
  }

  async get_customer(pcid) {
    // Get a customer from it's ID, usually from a work order.
    this.logger.debug(`getting customer ${pcid}`)
    const result = await this.connection.query(`SELECT * FROM pc_owner WHERE pcid = ${mysql.escape(pcid)}`)
    
    if (result.length == 0) {
      throw new Error(`invalid_customer`);
    } 

    const cust = result[0];
    const customer = {
      "id": cust.pcid,
      "name": cust.pcname,
      "device": cust.pcmake,
      "company": cust.pccompany || "Individual"
    }

    return customer;
  }

}

exports.Database = Database;