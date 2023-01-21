// Triarom Notify - Simple JS Implementation
// Cameron Fleming (c) 2023

const axios = require('axios');

class Notify {
  constructor(logger, config) {
    this.config = config;
    this.logger = logger.child({ module: 'notify' });
  }

  async v1_send(carrier, recipient, message) {
    const r = await axios.post(`${this.config.notify.server}/api/v1/messages`, {
      type: carrier,
      recipient: recipient,
      payload: {
        message: message
      }
    }).catch(err => err);

    if (r instanceof Error) {
      this.logger.error(`Error sending notification: ${r.message}`);
      return false;
    }

    if (r.status !== 201) {
      this.logger.error(`Error sending notification: ${r.status} ${r.statusText}`);
      return false;
    }

    this.logger.info("Notify Message sent successfully.")
    return true;
  }

  async send_msg(type, data) {
    if (!this.config.notify) return;
    if (!this.config.notify.enabled) return;

    switch(type) {
      case "daily_report":
        if (!this.config.notify.messages.daily_report) return;

        let msg = `PCRT Scan Daily Report:
        
        Scans today: ${data.scans}
        Actions today: ${data.action_count}
        Lockouts created: ${data.lockouts_created}
        Lockouts cleared: ${data.lockouts_cleared}
        
        Actions:`

        for (let action in data.actions) {
          msg += `
          ${action}: ${data.actions[action]}`;
        }

        msg += "End of Report"

        await this.v1_send(this.config.notify.messages.daily_report.carrier, this.config.notify.messages.daily_report.recipient, msg);
        break;

      case "lockout_created":
        if (!this.config.notify.messages.lockout_created) return;

        const msg_lockout = `PCRT Scan Lockout Created:
        Bay Number: ${data.slid}
        Engineer: ${data.engineer}

        Please write the reason for creating this lockout below, and tape this paper to the bay.
        Notes:
        
        

        
        
        
        
        
        End of Report.`; // TODO - Handle this better.

        await this.v1_send(this.config.notify.messages.lockout_created.carrier, this.config.notify.messages.lockout_created.recipient, msg_lockout); 
        break;
      
      default:
        this.logger.error(`Unknown notification type: ${type}`);
        break;
    }
  }
}

module.exports['Notify'] = Notify;