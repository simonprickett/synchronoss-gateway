const gateway = require('conectric-usb-gateway')
const moment = require('moment')
const request = require('request')

const APP_KEY = process.env.APP_KEY

const stringifyObject = obj => {
  const stringifiedObj = {}

  for (const k in obj) {
    stringifiedObj[k] = `${obj[k]}`
  }

  return stringifiedObj
}

const onSensorMessage = sensorMessage => {
  try {
    const messageDate = moment.unix(sensorMessage.timestamp).format('YYYY-MM-DD')
    const eventId = `${sensorMessage.sensorId}${sensorMessage.sequenceNumber}`
    const stringifiedPayload = stringifyObject(sensorMessage.payload)

    const payload = {
      EVENT_TYPE: sensorMessage.type,
      timestamp: `${sensorMessage.timestamp}`,
      sensorId: sensorMessage.sensorId,
      sequenceNumber: `${sensorMessage.sequenceNumber}`,
      gatewayId: gateway.macAddress,
      ...stringifiedPayload
    }

    const uri = `https://siprt.synchronoss.net/events?APP_KEY=${APP_KEY}&APP_VERSION=1&APP_MODULE=sip-iotsb&EVENT_ID=${eventId}&EVENT_DATE=${messageDate}&EVENT_TYPE=${sensorMessage.type}`

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
  } catch (err) {
    console.error('Error occurred sending message to API:')
    console.error(err)
  } 
}

if (! APP_KEY) {
  console.error('You must set the APP_KEY environment variable!')
  process.exit(1)
}

gateway.runGateway({
  onSensorMessage
})