// PCRT-Scan Engineer Lockout Service
// Allows engineers to lockout storage bays to stop PCRT assigning them.

// PCRT-Scan-Lockouts uses SqLite to store the lockout data, rather than a database.
// PCRT itself cannot see active lock-outs, assigning a bay manually to a locked-out bay will cause
// a conflict warning.

const sqlite3 = require('sqlite3')
const events = require('events')

class Lockouts {
  constructor(logger, config) {
    this.logger = logger.child({meta: {"service": "lockouts"}});
    this.logger.debug("lockouts invoked, loading");
    this.config = config;

    // Setup event emitters
    this.emitter = new events.EventEmitter();

    // Check if lockouts are configured in config
    if (!this.config.lockouts) {
      this.logger.warn("The lockouts feature has not been configured, please update your configuration file. Parts of PCRT-Scan may not work as expected without lockouts.");
      return;
    }

    // Setup and lock the database.
    this.db = new sqlite3.Database(this.config.lockouts.database_file, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (error) => {
      if (error) {
        this.logger.error("failed to initalise lockouts, exiting.");
        this.logger.error(error);
        process.exit(1);
      }
    })

    this.db.run("CREATE TABLE IF NOT EXISTS lockouts (id INTEGER PRIMARY KEY AUTOINCREMENT, bay TEXT, engineer TEXT, timestamp INTEGER, UNIQUE(id))", (error) => {
      if (error) {
        this.logger.error("failed to create lockouts table, exiting.");
        this.logger.error(error);
        process.exit(1);
      }
    })
  }

  async get_lockouts() {
    // Get all active lockouts
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      this.db.all("SELECT * FROM lockouts", (error, rows) => {
        if (error) {
          this.logger.error(error);
          throw new Error("lockout_read_fail");
        }
  
        resolve(rows);
      })
    })
  }

  async get_lockout_for_bay(slid) {
    // Get lockout for a specific bay
    // Returns a lockout if one exists, otherwise returns false.
    if (!this.db) return;

    this.logger.debug(`Getting lockout for bay ${slid}`)
    return new Promise((resolve, reject) => {
      this.db.get("SELECT * FROM lockouts WHERE bay = ?", slid, (error, row) => {
        if (error) {
          this.logger.error(error);
          throw new Error("lockout_read_fail");
        }

        if (row) {
          resolve(row);
        } else {
          resolve(false);
        }
      })
    })
  }

  async create_lockout(slid, engineer) {
    // Create a new lockout
    if (!this.db) return;

    this.logger.debug(`Creating lockout for bay ${slid} by engineer ${engineer}!`)
    this.db.run("INSERT INTO lockouts (bay, engineer, timestamp) VALUES (?, ?, ?)", [slid, engineer, Date.now()], (error) => {
      if (error) {
        this.logger.error(error);
        throw new Error("lockout_create_fail");
      }

      this.emitter.emit("lockout_created", {slid: slid, engineer: engineer});
      return this.logger.info(`Lockout created for bay ${slid} by engineer ${engineer}!`)
    })
  }

  async clear_lockout(id) {
    // Clear a lockout
    if (!this.db) return;
    
    this.logger.debug(`Clearing lockout ${id}!`)
    this.db.run("DELETE FROM lockouts WHERE id = ?", id, (error) => {
      if (error) {
        this.logger.error(error);
        throw new Error("lockout_clear_fail");
      }

      this.emitter.emit("lockout_cleared", {id: id});
      return this.logger.info(`Lockout ${id} cleared!`)
    })
  }

}

exports.Lockouts = Lockouts;