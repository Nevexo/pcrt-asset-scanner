// PCRT-Scan Transaction Logging Service
// Records all transactions performed by PCRT-Scan to a database.
// This is required for the daily reports feature.

const sqlite3 = require('sqlite3')
const events = require('events')

const TransactionType = {
  "scan": 1,
  "action_applied": 2,
  "lockout_change": 3
};

class Transactions {
  constructor(logger, config) {
    this.logger = logger.child({meta: {"service": "transactions"}});
    this.logger.debug("transactions invoked, loading");
    this.config = config;

    if (!this.config.transaction_logging.enable) {
      this.logger.debug("transactions disabled, exiting.");
      return;
    };

    // Setup event emitters
    this.emitter = new events.EventEmitter();

    // Setup and lock the database.
    this.db = new sqlite3.Database(this.config.transaction_logging.database_file, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (error) => {
      if (error) {
        this.logger.error("failed to initalise transactions, exiting.");
        this.logger.error(error);
        process.exit(1);
      }
    })

    this.db.run("CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, transaction_type INTEGER, transaction_time TIMESTAMP, transaction_data TEXT, UNIQUE(id))", (error) => {
      this.logger.info("transactions - database upgrade completed, transaction logging available.")
      if (error) {
        this.logger.error("failed to create transactions table, exiting.");
        this.logger.error(error);
        process.exit(1);
      }
    })
  }

  async log_transaction(type, data) {
    // Log a transaction to the database.
    if (!this.config.transaction_logging.enable) return;

    if (TransactionType[type] == undefined) {
      this.logger.error(`Invalid transaction type ${type} passed to log_transaction, ignoring.`);
      return;
    }

    this.db.run("INSERT INTO transactions (transaction_type, transaction_time, transaction_data) VALUES (?, ?, ?)", [TransactionType[type], Date.now(), JSON.stringify(data)], (error) => {
      if (error) {
        this.logger.error(error);
        throw new Error("transaction_log_fail");
      }

      this.logger.debug(`Logged transaction: ${type} - ${JSON.stringify(data)}`);
    })
  }

  async get_todays_transactions() {
    // Get all transactions for today.
    if (!this.config.transaction_logging.enable) return;

    return new Promise((resolve, reject) => {
      const start_date = new Date();
      start_date.setHours(0, 0, 0, 0); // Set to midnight
      const end_date = new Date();
      end_date.setHours(23, 59, 59, 999); // Set to 23:59:59.999

      this.db.all("SELECT * FROM transactions WHERE transaction_time > ? AND transaction_time < ?", [start_date, end_date], (error, rows) => {
        if (error) {
          this.logger.error(error);
          throw new Error("transaction_read_fail");
        }

        resolve(rows);
      })
    })
  }

  async get_transactions_for_date(date) {
    // Get all transactions for a specific date.
    // TODO: implement end stop
    if (!this.config.transaction_logging.enable) return;

    return new Promise((resolve, reject) => {
      this.db.all("SELECT * FROM transactions WHERE DATE(transaction_time) > ?", date, (error, rows) => {
        if (error) {
          this.logger.error(error);
          throw new Error("transaction_read_fail");
        }

        resolve(rows);
      })
    })
  }

  async get_all_transactions() {
    // Get all transactions.
    if (!this.config.transaction_logging.enable) return;

    return new Promise((resolve, reject) => {
      this.db.all("SELECT * FROM transactions", (error, rows) => {
        if (error) {
          this.logger.error(error);
          throw new Error("transaction_read_fail");
        }

        resolve(rows)
      })
    })
  }

  async daily_report() {
    // Generate a daily report.
    if (!this.config.transaction_logging.enable) return;

    let transactions = await this.get_todays_transactions();
    let report = {
      "scans": 0,
      "actions": {},
      "action_count": 0,
      "lockouts_created": 0,
      "lockouts_cleared": 0
    }

    for (let i = 0; i < transactions.length; i++) {
      let transaction = transactions[i];
      transaction.transaction_data = JSON.parse(transaction.transaction_data);

      switch (transaction.transaction_type) {
        case TransactionType.scan:
          report.scans++;
          break;
        case TransactionType.action_applied:
          report.action_count++;
          // Use action name alias if available, if not, fallback to the action
          let action_name = transaction.transaction_data.new_state_alias || transaction.transaction_data.action;

          if (report.actions[action_name] == undefined) report.actions[action_name] = 0;
          report.actions[action_name]++;
          break;
        case TransactionType.lockout_change:
          if (transaction.transaction_data.action == "create") {
            report.lockouts_created++;
          } else if (transaction.transaction_data.action == "clear") {
            report.lockouts_cleared++;
          }
          break;
      }
    }

    return report;
  }
}

exports.Transactions = Transactions;