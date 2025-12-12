import { Decoder, Encoder, Profile, Stream } from './fitsdk/src/index.js'

const makeStartTimerEvent = (date) => ({
  timestamp: date,
  event: 'timer',
  eventType: 'start',
  timerTrigger: 'auto',
  eventGroup: 0,
})

const makeStopTimerEvent = (date) => ({
  timestamp: date,
  event: 'timer',
  eventType: 'stopAll',
  timerTrigger: 'auto',
  eventGroup: 0,
})

const recordFields = Array.from(
  Object.values(Profile.messages[Profile.MesgNum.RECORD].fields)
)

function consolidateRecords(messages) {
  const messagesByTimestamp = messages.reduce((acc, curr) => {
    const timestamp = curr.timestamp.getTime()
    if (acc[timestamp]) {
      acc[timestamp] = {
        ...acc[timestamp],
        ...curr,
      }
    } else {
      acc[timestamp] = { ...curr }
    }
    return acc
  }, {})

  return (
    Array.from(Object.values(messagesByTimestamp))
      // Fixes weird issue where some readers where not able to properly read
      // the values of some fields.
      .map((message) =>
        Object.fromEntries(
          Object.entries(message).sort((a, b) => {
            const aField = recordFields.find((f) => f.name === a[0])
            const bField = recordFields.find((f) => f.name === b[0])
            return aField.num - bField.num
          })
        )
      )
      .sort((a, b) => a.timestamp - b.timestamp)
  )
}

export function convert(input, options = { calories: undefined }) {
  const stream = Stream.fromByteArray(input)
  const decoder = new Decoder(stream)
  if (!decoder.checkIntegrity()) {
    throw new Error('FIT file integrity check failed')
  }

  const { messages, errors } = decoder.read()
  if (errors.length > 0) {
    throw new Error('Errors encountered while reading FIT file')
  }

  const { fileIdMesgs, recordMesgs, lapMesgs, sessionMesgs, ...other } =
    messages
  if (other.length > 0) {
    throw new Error('FIT includes unsupported message types')
  }

  if (!Array.isArray(sessionMesgs) || sessionMesgs.length !== 1) {
    throw new Error('Expected exactly one session message')
  }

  if (!Array.isArray(fileIdMesgs) || fileIdMesgs.length !== 1) {
    throw new Error('Expected exactly one file ID message')
  }

  if (!Array.isArray(lapMesgs) || lapMesgs.length !== 1) {
    throw new Error('Expected exactly one lap message')
  }

  // Create an Encoder
  const encoder = new Encoder()

  encoder.onMesg(Profile.MesgNum.FILE_ID, {
    ...fileIdMesgs[0],
  })

  const consolidatedRecords = consolidateRecords(recordMesgs)

  let lastTimestamp
  let pauses = 0
  for (const record of consolidatedRecords) {
    const currentTimestamp = record.timestamp.getTime()

    if (lastTimestamp) {
      if (currentTimestamp - lastTimestamp > 5000) {
        pauses += currentTimestamp - 1000 - lastTimestamp

        encoder.onMesg(
          Profile.MesgNum.EVENT,
          makeStopTimerEvent(new Date(lastTimestamp + 1000))
        )
        encoder.onMesg(
          Profile.MesgNum.EVENT,
          makeStartTimerEvent(new Date(currentTimestamp - 1000))
        )
      }
    } else {
      encoder.onMesg(
        Profile.MesgNum.EVENT,
        makeStartTimerEvent(new Date(currentTimestamp))
      )
    }

    lastTimestamp = currentTimestamp
    encoder.onMesg(Profile.MesgNum.RECORD, record)
  }

  if (!(Array.isArray(sessionMesgs) && sessionMesgs.length === 1)) {
    throw new Error('supports only a single session')
  }

  const firstTimestamp = consolidatedRecords[0].timestamp.getTime()

  const totalElapsedTime = (lastTimestamp - firstTimestamp) / 1000
  const totalTimerTime = totalElapsedTime - pauses / 1000

  encoder.onMesg(
    Profile.MesgNum.EVENT,
    makeStopTimerEvent(new Date(lastTimestamp))
  )

  encoder.onMesg(Profile.MesgNum.LAP, {
    timestamp: new Date(lastTimestamp),
    startTime: new Date(firstTimestamp),
    totalElapsedTime: totalElapsedTime,
    totalTimerTime: totalTimerTime,
    ...(options.calories ? { totalCalories: options.calories } : {}),
  })

  encoder.onMesg(Profile.MesgNum.SESSION, {
    ...sessionMesgs[0],

    // Corrects timestamp and start time. Flow sets both to the value of the timestamp of FileID message.
    // That is wrong. The same happens for the Lap message.
    timestamp: new Date(lastTimestamp),
    startTime: new Date(firstTimestamp),

    // Corrects total elapsed time and timer time based on the automatically added pauses. The original
    // Flow FIT file does not include events for stopping and pausing. Yet, it has different elapsed times
    // and timer times. That information is lacking.
    totalElapsedTime: totalElapsedTime,
    totalTimerTime: totalTimerTime,

    trigger: 'activityEnd',
    sport: 'eBiking',
    subSport: 'generic',
    eventType: 'stop',

    totalCalories: options.calories,
  })

  encoder.onMesg(Profile.MesgNum.ACTIVITY, {
    timestamp: new Date(lastTimestamp),
    numSessions: 1,
    type: 'manual',
    event: 'activity',
    eventType: 'stop',
    totalTimerTime: totalTimerTime,
  })

  return encoder.close()
}
