# PCRT Asset Scan System

This tool used to scan asset devices/groups into the storage locations for PC Repair Tracker. It interfaces directly wih the MySQL database as the APIs are hideous.

This isn't the best codebase at all, but should just about do the trick.

This is highly specalised to use at Triarom.

## PCRT-Scan Server
The central server of PCRT-Scan is the "hub" between all the sections, the scanner agents, PCRT-Scan frontend and PCRT's database.

PCRT-Scan has a connection to PCRT's MySQL database, typically via a VPN, but it can be over the local network. 

PCRT-Scan Server contains the main config.yaml file, which configures most of how PCRT-Scan operates, including some settings for the front-end.
Copy config-example.yaml to config.yaml and modify the settings as required, then start PCRT-Scan with

```
node index.js
```

You may wish to run PCRT-Scan under some form of daemon, or a containerisation platform. 

PCRT-Scan runs two Socket.io WebSockets on the ports specified in config.yaml, one is used by Scanner Agents and the other by the frontend.
Only one scanner agent may connect to the system at one time, for now at least.

Any number of frontend sessions can connect to the client websocket, they will recieve broadcast messages from the server to display various states of the system.
PCRT-Scan periodically checks the database for changes to storage locations etc, broadcasts will be sent to the frontend for these interactions.

## Scanner Agents

PCRT connects to scanners using scanner agents, these are tools that interface with the physical scanner (we're using an EYOYO 2D scanner) and forward it's messages into PCRT-Server over the socket. 

com-scanner-agent is a temporary implementation of a scanner agent that listens to the scanner as a serial device, on the EYOYO device you must scan the USB-COM QR code in the manual to enable this mode.

Other scanner agents may be implemented in the future.

