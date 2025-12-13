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
      // This sortering should be done by the SDK itself. Should validate against new SDK
      // version to see if still a problem.
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

// Calculates the average power for a given collection of records (a lap). This
// is done by weighting the power through the time, and dividing it by the total time.
// This is not 100% accurate, but should be good enough to distribute calories.
function calculateAveragePower(lap) {
  const records = lap.filter((r) => typeof r.power === 'number')
  if (records.length === 1) {
    return records[0].power
  }

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

// Splits the records into laps based on pauses in the activity. A pause is defined
// as a gap of more than 60 seconds between two records. This is based on observations
// of how the Flow app handles pauses.
function groupRecordsIntoLaps(records) {
  const laps = records.reduce((laps, record) => {
    if (laps.length === 0) {
      laps.push([])
    } else if (laps[laps.length - 1].length > 0) {
      const lastLap = laps[laps.length - 1]
      const lastRecord = lastLap[lastLap.length - 1]
      if (
        record.timestamp.getTime() - lastRecord.timestamp.getTime() >
        60000 // 60 seconds
      ) {
        laps.push([])
      }
    }

    laps[laps.length - 1].push(record)
    return laps
  }, [])

  return laps.map((records) => ({
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
    console.error('Failed to decode FIT file', errors)
    throw new Error('Failed to decode FIT file.')
  }

  const { fileIdMesgs, recordMesgs, lapMesgs, sessionMesgs, ...other } =
    messages
  if (other.length > 0) {
    throw new Error('FIT includes unsupported message types')
  }

  if (!Array.isArray(sessionMesgs) || sessionMesgs.length !== 1) {
    throw new Error('Expected exactly one session message.')
  }

  if (!Array.isArray(fileIdMesgs) || fileIdMesgs.length !== 1) {
    throw new Error('Expected exactly one file ID message.')
  }

  if (!Array.isArray(lapMesgs) || lapMesgs.length !== 1) {
    throw new Error('Expected exactly one lap message.')
  }

  console.debug(`File ID message:`, fileIdMesgs[0])
  console.debug(`Found ${recordMesgs.length} record messages.`)

  // Create an Encoder
  const encoder = new Encoder()

  encoder.onMesg(Profile.MesgNum.FILE_ID, {
    ...fileIdMesgs[0],
  })

  const consolidatedRecords = consolidateRecords(recordMesgs)
  console.debug(
    `Consolidated to ${consolidatedRecords.length} record messages.`
  )

  const groupedRecords = groupRecordsIntoLaps(consolidatedRecords)
  console.debug(`Grouped into ${groupedRecords.length} laps.`)

  const firstTimestamp = consolidatedRecords[0].timestamp.getTime()
  const lastTimestamp =
    consolidatedRecords[consolidatedRecords.length - 1].timestamp.getTime() +
    1000

  const totalPower = groupedRecords.reduce(
    (acc, group) => acc + group.averagePower,
    0
  )

  const totalElapsedTime = (lastTimestamp - firstTimestamp) / 1000
  let totalTimerTime = 0

  for (let i = 0; i < groupedRecords.length; i++) {
    const { records, averagePower } = groupedRecords[i]
    if (records.length === 1) {
      // Hopefully won't happen.
      throw new Error('Expected more than one record in each lap.')
    }

    const lapStart = records[0].timestamp.getTime()
    const lapEnd = records[records.length - 1].timestamp.getTime() + 1000
    const lapTime = (lapEnd - lapStart) / 1000

    // Create a lap message for the pause before this lap. According to the
    // specification, "Lap messages should be sequential and non-overlapping,
    // and the sum of the total elapsed time and distance values for all Lap
    // messages should equal the total elapsed time and distance for the
    // corresponding Session message."
    //
    // So it sounds like we need to create an empty lap for the pauses with 0
    // calories in order to have a proportional calory distribution. Bosch only
    // counts the calories of the active parts:
    // https://help.bosch-ebike.com/ca/help-center/ebw-flowapp-activitytracking/asset-asf-01050
    if (i !== 0) {
      const { records: previousLap } = groupedRecords[i - 1]
      const pauseStart =
        previousLap[previousLap.length - 1].timestamp.getTime() + 1000
      const pauseEnd = lapStart
      const pauseTime = (pauseEnd - pauseStart) / 1000

      encoder.onMesg(Profile.MesgNum.LAP, {
        timestamp: new Date(pauseEnd),
        startTime: new Date(pauseStart),
        totalElapsedTime: pauseTime,
        totalTimerTime: 0,
        totalCalories: 0,
      })
    }

    // Add start timer event, records, and stop timer event
    encoder.onMesg(
      Profile.MesgNum.EVENT,
      makeStartTimerEvent(new Date(lapStart))
    )
    for (const record of records) {
      encoder.onMesg(Profile.MesgNum.RECORD, record)
    }
    encoder.onMesg(Profile.MesgNum.EVENT, makeStopTimerEvent(new Date(lapEnd)))

    // Add lap message with weighted calories based on estimated average power
    encoder.onMesg(Profile.MesgNum.LAP, {
      timestamp: new Date(lapEnd),
      startTime: new Date(lapStart),
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
