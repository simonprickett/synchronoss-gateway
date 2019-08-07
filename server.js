const gateway = require('conectric-usb-gateway-beta')
const moment = require('moment')
const request = require('request')
const Joi = require('@hapi/joi')
const ekmdecoder = require('./ekmdecoder')

let ekmData = {
  dataChunksA: [],
  dataChunksB: []
};

let config
let meterReadingInterval
let currentMeter = 0
let meterMappings
let metersEnabled = false

const moveToNextMeter = () => {
  if (currentMeter === meterMappings.meters.length - 1) {
    currentMeter = 0
  } else {
    currentMeter++
  }
}

const getCurrentMeter = () => {
  return meterMappings.meters[currentMeter]
}

const verifyConfig = () => {
  const validationResult = Joi.validate(config, Joi.object().keys({
    apiUrl: Joi.string().uri(),
    appKey: Joi.string().min(1).required(),
    appVersion: Joi.string().min(1).required(),
    appModule: Joi.string().min(1).required(),
    requestTimeout: Joi.number().integer().min(60).required(),
    readingInterval: Joi.number().integer().min(60).required()
  }).required().options({
    allowUnknown: false
  }))

  if (validationResult.error) {
      console.error('Errors detected in config file:')
      console.error(validationResult.error.message)
      process.exit(1)
  }

  // Set the parameters that are passed in seconds to be 
  // milliseconds.
  config.requestTimeout = config.requestTimeout * 1000
  config.readingInterval = config.readingInterval * 1000
}

const encodeMeterSerialNumber = serialNumber => {
  let encodedMeterSerialNumber = ''

  for (let n = 0; n < serialNumber.length; n++) {
    encodedMeterSerialNumber = `${encodedMeterSerialNumber}3${serialNumber[n]}`
  }

  return encodedMeterSerialNumber
}

const verifyMeterMappings = () => {
  const validationResult = Joi.validate(meterMappings, Joi.object().keys({
    meters: Joi.array().items(Joi.object().keys({
      serialNumber: Joi.string().length(12).required(),
      rs485HubId: Joi.string().length(4).required(),
      version: Joi.number().integer().min(4).max(4).required()
    }).optional())
  }).required().options({
    allowUnknown: false
  }))

  if (validationResult.error) {
    console.error('Errors detected in config file:')
    console.error(validationResult.error.message)
    process.exit(1)
  }

  for (const meter of meterMappings.meters) {
    meter.hexSerialNumber = encodeMeterSerialNumber(meter.serialNumber)
  }

  metersEnabled = (meterMappings.meters.length > 0)

  if (! metersEnabled) {
    console.log('Meter reading functionality disabled - no meters found in meters.json.')
  }
}

const sendToSynchronoss = (sensorId, sequenceNumber, timestamp, type, payload) => {
  const messageDate = moment.unix(timestamp).format('YYYY-MM-DD')
  const eventId = `${sensorId}${sequenceNumber}`
  const uri = `${config.apiUrl}?APP_KEY=${config.appKey}&APP_VERSION=${config.appVersion}&APP_MODULE=${config.appModule}&EVENT_ID=${eventId}&EVENT_DATE=${messageDate}&EVENT_TYPE=${type}`

  console.log(uri)
  console.log(payload)

  request({
    method: 'POST',
    uri,
    json: true,
    body: payload
  }, (err, res, body) => {
    if (err) {
      console.error('Error posting to API:')
      console.error(err)
    } else {
      if (res.statusCode === 200 && body.result && body.result === 'success') {
        console.log(`Sent message, registeredID: ${body.registeredID}`)
      } else {
        console.error(`Error posting to API, statusCode: ${res.statusCode}`)
        console.error(res.body)
      }
    }
  })
}

const stringifyObject = obj => {
  const stringifiedObj = {}

  for (const k in obj) {
    stringifiedObj[k] = `${obj[k]}`
  }

  return stringifiedObj
}

const clearMeterReadingInterval = () => {
  clearTimeout(meterReadingInterval);
  meterReadingInterval = undefined
}

const sendMeterRequest = (meterSerialNumberHex, destination) => {
  gateway.sendRS485Request({
    message: `2F3F${meterSerialNumberHex}303${ekmData.currentMessageType === 'A' ? 0 : 1}210D0A`,
    destination,
    hexEncodePayload: false
  })
  console.log(`Sent request for ${ekmData.currentMessageType} message to ${meterSerialNumberHex}.`)

  clearMeterReadingInterval()

  meterReadingInterval = setTimeout(() => {
    meterReadingInterval = undefined

    console.log('Starting a new reading request.')
    ekmData.currentMessageType = 'A'
    ekmData.dataChunksA = []
    ekmData.dataChunksB = []

    moveToNextMeter()
    const meter = getCurrentMeter()
    sendMeterRequest(meter.hexSerialNumber, meter.rs485HubId)
  }, config.requestTimeout)
}

const startNextMeterRequest = () => {
  setTimeout(() => {
    console.log('Starting a new reading request.')
    ekmData.currentMessageType = 'A'
    ekmData.dataChunksA = []
    ekmData.dataChunksB = []
    moveToNextMeter()
    const meter = getCurrentMeter()
    sendMeterRequest(meter.hexSerialNumber, meter.rs485HubId)
  }, config.readingInterval)
}

const onGatewayReady = () => {
  console.log('Gateway is ready to send messages.')
  ekmData.currentMessageType = 'A'

  if (metersEnabled) {
    const meter = getCurrentMeter()
    sendMeterRequest(meter.hexSerialNumber, meter.rs485HubId)
  }
}

const onSensorMessage = sensorMessage => {
  if (! metersEnabled) {
    // If this gateway is not configured for meter reading, ignore 
    // those message types.
    const meterReadingMessages = ['rs485ChunkEnvelopeResponse', 'rs485ChunkResponse']

    if (meterReadingMessages.includes(sensorMessage.type)) {
      return
    }
  }

  console.log(sensorMessage)

  try {
    if (sensorMessage.type === 'rs485ChunkEnvelopeResponse') {
      if (ekmData.currentMessageType === 'A') {
        ekmData.dataChunksA = []
        ekmData.dataChunksB = []
      }
      ekmData.chunkSize = sensorMessage.payload.chunkSize
      ekmData.chunkToRequest = 0
      ekmData.numChunks = sensorMessage.payload.numChunks

      setTimeout(() => {
        gateway.sendRS485ChunkRequest({
          chunkNumber: ekmData.chunkToRequest,
          chunkSize: ekmData.chunkSize,
          destination: sensorMessage.sensorId
        })

        console.log(`Sent request for message ${ekmData.currentMessageType} chunk ${ekmData.chunkToRequest}`)
      }, 1000)
    } else if (sensorMessage.type === 'rs485ChunkResponse') {
      if (ekmData.chunkToRequest < (ekmData.numChunks - 1)) {
        if (ekmData.currentMessageType === 'A') {
          ekmData.dataChunksA.push(sensorMessage.payload.data)
	  console.log(`dataChunksA: ${ekmData.dataChunksA.length}`)
        } else {
          ekmData.dataChunksB.push(sensorMessage.payload.data)
	  console.log(`dataChunksB: ${ekmData.dataChunksB.length}`)
        }

        console.log(`Received chunk ${ekmData.chunkToRequest}`)
        ekmData.chunkToRequest++

        setTimeout(() => {
          gateway.sendRS485ChunkRequest({
            chunkNumber: ekmData.chunkToRequest,
            chunkSize: ekmData.chunkSize,
            destination: sensorMessage.sensorId
          })

          console.log(`Sent request for message ${ekmData.currentMessageType} chunk ${ekmData.chunkToRequest}`)
        }, 1000)
      } else {
        console.log(`Received chunk ${ekmData.chunkToRequest}`)

        // Drop the last byte from the final chunk.
        if (ekmData.currentMessageType === 'A') {
          ekmData.dataChunksA.push(sensorMessage.payload.data.substring(0, sensorMessage.payload.data.length - 2))
	  console.log(`dataChunksA: ${ekmData.dataChunksA.length}`)
        } else {
          ekmData.dataChunksB.push(sensorMessage.payload.data.substring(0, sensorMessage.payload.data.length - 2))
	  console.log(`dataChunksB: ${ekmData.dataChunksB.length}`)
        }
        
        // Stop the timeout.
        clearMeterReadingInterval()

        if (ekmData.currentMessageType === 'A') {
          // Check CRC on A message
          if (! ekmdecoder.crcCheck(ekmData.dataChunksA.join(''))) {
            console.log('Meter message A CRC check failed, skipping this meter for now.');
            startNextMeterRequest()
          } else {
            console.log('Meter message A CRC check passed.')
            // Send EKM v4 meter message type B
            ekmData.currentMessageType = 'B'
            setTimeout(() => {     
              const meter = getCurrentMeter()     
              sendMeterRequest(meter.hexSerialNumber, meter.rs485HubId)
            }, 1000)
          }
        } else {
          if (! ekmdecoder.crcCheck(ekmData.dataChunksB.join(''))) {
            console.log('Meter message B CRC check failed, skipping this meter for now.');
            startNextMeterRequest()
          } else {
            console.log('Meter message B CRC check passed.')
            // We now have the complete meter reading.
            sendToSynchronoss(sensorMessage.sensorId, sensorMessage.sequenceNumber, sensorMessage.timestamp, 'meter', {
              EVENT_TYPE: 'meter',
              timestamp: `${sensorMessage.timestamp}`,
              sensorId: sensorMessage.sensorId,
              sequenceNumber: `${sensorMessage.sequenceNumber}`,
              gatewayId: gateway.macAddress,
              ...stringifyObject(ekmdecoder.decodeV4Message(ekmData.dataChunksA.join(''), ekmData.dataChunksB.join('')))
            })
    
            // Set off the reading process again.
            startNextMeterRequest()
          }
        }
      }
    } else {
      // This is a normal message.
      sendToSynchronoss(sensorMessage.sensorId, sensorMessage.sequenceNumber, sensorMessage.timestamp, sensorMessage.type, {
        EVENT_TYPE: sensorMessage.type,
        timestamp: `${sensorMessage.timestamp}`,
        sensorId: sensorMessage.sensorId,
        sequenceNumber: `${sensorMessage.sequenceNumber}`,
        gatewayId: gateway.macAddress,
        ...stringifyObject(sensorMessage.payload)
      })
    }
  } catch (err) {
    console.error('Error occurred sending message to API:')
    console.error(err)
  }
}

// Load configuration file.
try {
  config = require('./config.json')
} catch (e) {
  console.error('Failed to load config.json!')
  process.exit(1)
}

// Verify configuration file.
verifyConfig()

// Load meters file.
try {
  meterMappings = require('./meters.json')
} catch (e) {
  console.error('Failed to load meters.json!')
  process.exit(1)
}

// Verify meters file.
verifyMeterMappings()

gateway.runGateway({
  onSensorMessage,
  onGatewayReady
})
