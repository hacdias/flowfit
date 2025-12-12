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
      // Fixes weird issue where some readers are not able to read the values of some fields.
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

function calculateAveragePower(lap) {
  const records = lap.filter((r) => typeof r.power === 'number')
  if (records.length === 1) {
    return records[0].power
  }

  // This is an estimation. It could be that there's many missing points of power
  // in the whole lap. The idea is mostly to have a weight to be able to distribute
  // the calories.
  const weightedPower = records.reduce(
    (acc, _, i, a) =>
      i === 0
        ? a[i].power
        : acc +
          a[i].power *
            (a[i].timestamp.getTime() - a[i - 1].timestamp.getTime()),
    0
  )

  const start = records[0].timestamp.getTime()
  const end = records[records.length - 1].timestamp.getTime()
  return weightedPower / (end - start)
}

function splitRecordsIntoLaps(records) {
  const activeGroups = records.reduce((laps, record) => {
    if (laps.length === 0) {
      laps.push([])
    } else if (laps[laps.length - 1].length > 0) {
      const lastLap = laps[laps.length - 1]
      const lastRecord = lastLap[lastLap.length - 1]
      if (
        record.timestamp.getTime() - lastRecord.timestamp.getTime() >
        60000 // 60 seconds - seems to be the threshold for pauses.
      ) {
        laps.push([])
      }
    }

    laps[laps.length - 1].push(record)
    return laps
  }, [])

  return activeGroups.map((records) => ({
    records,
    averagePower: calculateAveragePower(records),
  }))
}

export function convert(input, options = { calories }) {
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
  const groupedRecords = splitRecordsIntoLaps(consolidatedRecords)

  const firstTimestamp = consolidatedRecords[0].timestamp.getTime()
  const lastTimestamp =
    consolidatedRecords[consolidatedRecords.length - 1].timestamp.getTime()

  const totalPower = groupedRecords.reduce(
    (acc, group) => acc + group.averagePower,
    0
  )
  const totalElapsedTime = (lastTimestamp - firstTimestamp) / 1000
  let totalTimerTime = 0

  for (const { records: lap, averagePower } of groupedRecords) {
    const start = lap[0].timestamp.getTime()
    const end = lap[lap.length - 1].timestamp.getTime()
    const lapTime = (end - start) / 1000

    if (lap.length === 1) {
      // Hopefully won't happen, but if it does and you're seeing this,
      // contact me!
      throw new Error('Expected more than one record in each lap')
    }

    // Add start timer event, records, and stop timer event
    encoder.onMesg(Profile.MesgNum.EVENT, makeStartTimerEvent(new Date(start)))
    for (const record of lap) {
      encoder.onMesg(Profile.MesgNum.RECORD, record)
    }
    encoder.onMesg(Profile.MesgNum.EVENT, makeStopTimerEvent(new Date(end)))

    // Add lap message with weighted calories based on estimated average power
    encoder.onMesg(Profile.MesgNum.LAP, {
      timestamp: new Date(end),
      startTime: new Date(start),
      totalElapsedTime: lapTime,
      totalTimerTime: lapTime,
      totalCalories: options.calories * (averagePower / totalPower),
    })

    totalTimerTime += lapTime
  }

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

    totalCalories: options.calories,
    trigger: 'activityEnd',
    sport: 'eBiking',
    subSport: 'generic',
    eventType: 'stop',
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
