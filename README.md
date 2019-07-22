# Synchronoss Gateway for Conectric Sensors

Gateway code to receive sensor and EKM v4 meter readings from the Conectric mesh network and forward it to the Synchronoss SIP API.

## Installation

Clone this repo then:

```
cd <directory where repo was cloned to>
npm install
```

Note that if you are upgrading from an older version of this software, you should run `rm -rf node_modules` before running `npm install`.  This ensures that you have all of the dependencies at their expected versions.

## Setup

Plug a Conectric USB router into an available USB port.

Edit `config.json` to set the correct API base URL and API key.  Edit `meters.json` to include your EKM v4 meters.

Then:

```
$ npm install
$ npm start
```

## config.json

Contains configurable parameters.

```
{
    "apiUrl": "<SIP URL to post data to> e.g. https://siprt.acme.com/events",
    "appKey": "<SIP app key> e.g. MYSECRET",
    "requestTimeout": <Seconds that a meter read can run for before being considered timed out, min 60>,
    "readingInterval": <Seconds between successfully reading a meter and starting the next read, min 60>
}
```

## meters.json

Contains an array of EKM v4 meters to be read, and information about which RS485 hub each meter is connected to.

```
{
    "meters": [
        {
            "serialNumber": "000300004299",
            "rs485HubID": "0000",
            "version": 4
        },
        ...
    ]
}
```

To run this without any meters, use:

```
{
    "meters": [
    ]
}
```