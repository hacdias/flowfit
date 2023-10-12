import ObjcFIT
import SwiftFIT

enum ConvertError: Error {
    case runtimeError(String)
}

func convert(input: String, output: String, calories: UInt16?) throws {
    let inputMessages = try getMessages(input: input)
    let messages = try cleanMessages(inputMessages, calories: calories)
    let encoder = FITEncoder(version: .V20)

    guard encoder.open(output) else {
        throw ConvertError.runtimeError("cannot open output file")
    }

    for message in messages {
        encoder.write(message)
    }

    if !encoder.close() {
        throw ConvertError.runtimeError("cannot close output file")
    }
}

class MessageCollector: NSObject, FITMesgDelegate {
    var messages: [FITMessage] = [];
    
    public func onMesg(_ msg: FITMessage) {
        messages.append(msg)
    }
}

func getMessages(input: String) throws -> [FITMessage] {
    let decoder = FITDecoder()
    let listener = MessageCollector()
    decoder.mesgDelegate = listener
    
    guard decoder.checkIntegrity(input) else {
        throw ConvertError.runtimeError("input file is invalid")
    }
    
    guard decoder.decodeFile(input) else {
        throw ConvertError.runtimeError("input file cannot be decoded")
    }
    
    return listener.messages
}

func cleanMessages(_ oldMessages: [FITMessage], calories: UInt16? = nil) throws -> [FITMessage] {
    var messages: [FITMessage] = []

    var recordTimestampToIndex: [Double : Int] = [Double : Int]()
    var firstRecord: FITRecordMesg? = nil;
    var lastRecord: FITRecordMesg? = nil;
    var session: FITSessionMesg? = nil;
    var intervals: TimeInterval = 0;

    for message in oldMessages {
        switch message.getNum() {
        case FITMesgNumRecord:
            
            let currentRecord = FITRecordMesg(message: message)
            let currentTimestamp = currentRecord.getTimestamp().date.timeIntervalSince1970

            if firstRecord == nil {
                // Add first timer event, and store first record.
                messages.append(makeStartTimerEvent(currentRecord.getTimestamp()))
                firstRecord = currentRecord
            }
            
            if let lastRecord {
                let lastTimestamp = lastRecord.getTimestamp().date.timeIntervalSince1970
                if currentTimestamp - lastTimestamp > 5 {
                    intervals += (currentTimestamp - 1) - lastTimestamp
                    messages.append(makeStopTimerEvent(FITDate(date: Date(timeIntervalSince1970: lastTimestamp + 1))))
                    messages.append(makeStartTimerEvent(FITDate(date: Date(timeIntervalSince1970: currentTimestamp - 1))))
                }
            }

            if let i = recordTimestampToIndex[currentTimestamp] {
                let oldRec = FITRecordMesg(message: messages[i])
                messages[i] = mergeRecords(oldRecord: oldRec, newRecord: currentRecord)
                lastRecord = FITRecordMesg(message: messages[i])
            } else {
                recordTimestampToIndex[currentTimestamp] = messages.count
                messages.append(message)
                lastRecord = currentRecord
            }
            break
        case FITMesgNumSession:
            guard session == nil else {
                throw ConvertError.runtimeError("unexpected double session")
            }
            
            guard let firstRecord else {
                throw ConvertError.runtimeError("first record must be defined")
            }
            
            guard let lastRecord else {
                throw ConvertError.runtimeError("last record must be defined")
            }

            let firstTs = firstRecord.getTimestamp()
            let lastTs = lastRecord.getTimestamp()
            let elapsedTime = Float(lastTs.date.timeIntervalSince1970 - firstTs.date.timeIntervalSince1970)
            let timerTime = elapsedTime - Float(intervals)
            
            let ses = FITSessionMesg(message: message)
            
            // Corrects timestamp and start time. Flow sets both to the value of the timestamp of FileID message.
            // That is wrong. The same happens for the Lap message.
            ses.setTimestamp(lastTs)
            ses.setStartTime(firstTs)
            
            // Corrects total elapsed time and timer time based on the automatically added intervals. The original
            // Flow FIT file does not include events for stopping and pausing. Yet, it has different elapsed times
            // and timer times. That information is lacking.
            ses.setTotalElapsedTime(elapsedTime)
            ses.setTotalTimerTime(timerTime)
            
            // Add calories if set.
            if let calories {
                ses.setTotalCalories(calories)
            }
            
            // Ensure remaining information is correct.
            ses.setTrigger(FITSessionTriggerActivityEnd)
            ses.setSport(FITSportEBiking)
            ses.setSubSport(FITSubSportGeneric)
            ses.setEventType(FITEventTypeStop)
            
            session = ses
            
            // Similarly to above, the Lap message from Flow FIT is wrong. Let's add our own with the right
            // information.
            let lap = FITLapMesg()
            lap.setTimestamp(lastTs)
            lap.setStartTime(firstTs)
            lap.setTotalElapsedTime(elapsedTime)
            lap.setTotalTimerTime(timerTime)
            if let calories {
                lap.setTotalCalories(calories)
            }
            
            // Add last timer event.
            messages.append(makeStopTimerEvent(lastTs))
            messages.append(lap)
            messages.append(ses)
            break
        case FITMesgNumLap:
            // The lap messages recorded by eBike Flow do not have the correct start time and timestamp
            // so we add them with the session data above.
            break
        default:
            messages.append(message)
            break
        }
    }

    guard let session else {
        throw ConvertError.runtimeError("session not defined")
    }
    
    let activity = FITActivityMesg()
    activity.setTimestamp(session.getTimestamp())
    activity.setNumSessions(1)
    activity.setType(FITActivityManual)
    activity.setEvent(FITEventActivity)
    activity.setEventType(FITEventTypeStop)
    activity.setTotalTimerTime(session.getTotalTimerTime())
    messages.append(activity)
    
    return messages
}

func makeStartTimerEvent(_ date: FITDate) -> FITEventMesg {
    let msg = FITEventMesg()
    msg.setTimestamp(date)
    msg.setEvent(FITEventTimer)
    msg.setTimerTrigger(FITTimerTriggerManual)
    msg.setEventType(FITEventTypeStart)
    msg.setEventGroup(0)
    return msg
}

func makeStopTimerEvent(_ date: FITDate) -> FITEventMesg {
    let msg = FITEventMesg()
    msg.setTimestamp(date)
    msg.setEvent(FITEventTimer)
    msg.setTimerTrigger(FITTimerTriggerManual)
    msg.setEventType(FITEventTypeStopAll)
    msg.setEventGroup(0)
    return msg
}

func mergeRecords(oldRecord: FITRecordMesg, newRecord: FITRecordMesg) -> FITMessage {
    if !oldRecord.isPositionLatValid() && newRecord.isPositionLatValid() { oldRecord.setPositionLat(newRecord.getPositionLat()) }
    if !oldRecord.isPositionLongValid() && newRecord.isPositionLongValid() { oldRecord.setPositionLong(newRecord.getPositionLong()) }
    if !oldRecord.isAltitudeValid() && newRecord.isAltitudeValid() { oldRecord.setAltitude(newRecord.getAltitude()) }
    if !oldRecord.isHeartRateValid() && newRecord.isHeartRateValid() { oldRecord.setHeartRate(newRecord.getHeartRate()) }
    if !oldRecord.isCadenceValid() && newRecord.isCadenceValid() { oldRecord.setCadence(newRecord.getCadence()) }
    if !oldRecord.isDistanceValid() && newRecord.isDistanceValid() { oldRecord.setDistance(newRecord.getDistance()) }
    if !oldRecord.isSpeedValid() && newRecord.isSpeedValid() { oldRecord.setSpeed(newRecord.getSpeed()) }
    if !oldRecord.isPowerValid() && newRecord.isPowerValid() { oldRecord.setPower(newRecord.getPower()) }
    // if !rec.isCompressedSpeedDistanceValid() && msg.isCompressedSpeedDistanceValid() { rec.setCompressedSpeedDistance(msg.getCompressedSpeedDistance()) }
    if !oldRecord.isGradeValid() && newRecord.isGradeValid() { oldRecord.setGrade(newRecord.getGrade()) }
    if !oldRecord.isResistanceValid() && newRecord.isResistanceValid() { oldRecord.setResistance(newRecord.getResistance()) }
    if !oldRecord.isTimeFromCourseValid() && newRecord.isTimeFromCourseValid() { oldRecord.setTimeFromCourse(newRecord.getTimeFromCourse()) }
    if !oldRecord.isCycleLengthValid() && newRecord.isCycleLengthValid() { oldRecord.setCycleLength(newRecord.getCycleLength()) }
    if !oldRecord.isTemperatureValid() && newRecord.isTemperatureValid() { oldRecord.setTemperature(newRecord.getTemperature()) }
    // if !rec.isSpeed1sValid() && msg.isSpeed1sValid() { rec.setSpeed1s(msg.getSpeed1s()) }
    if !oldRecord.isCyclesValid() && newRecord.isCyclesValid() { oldRecord.setCycles(newRecord.getCycles()) }
    if !oldRecord.isTotalCyclesValid() && newRecord.isTotalCyclesValid() { oldRecord.setTotalCycles(newRecord.getTotalCycles()) }
    if !oldRecord.isCompressedAccumulatedPowerValid() && newRecord.isCompressedAccumulatedPowerValid() { oldRecord.setCompressedAccumulatedPower(newRecord.getCompressedAccumulatedPower()) }
    if !oldRecord.isAccumulatedPowerValid() && newRecord.isAccumulatedPowerValid() { oldRecord.setAccumulatedPower(newRecord.getAccumulatedPower()) }
    if !oldRecord.isLeftRightBalanceValid() && newRecord.isLeftRightBalanceValid() { oldRecord.setLeftRightBalance(newRecord.getLeftRightBalance()) }
    if !oldRecord.isGpsAccuracyValid() && newRecord.isGpsAccuracyValid() { oldRecord.setGpsAccuracy(newRecord.getGpsAccuracy()) }
    if !oldRecord.isVerticalSpeedValid() && newRecord.isVerticalSpeedValid() { oldRecord.setVerticalSpeed(newRecord.getVerticalSpeed()) }
    if !oldRecord.isCaloriesValid() && newRecord.isCaloriesValid() { oldRecord.setCalories(newRecord.getCalories()) }
    if !oldRecord.isVerticalOscillationValid() && newRecord.isVerticalOscillationValid() { oldRecord.setVerticalOscillation(newRecord.getVerticalOscillation()) }
    if !oldRecord.isStanceTimePercentValid() && newRecord.isStanceTimePercentValid() { oldRecord.setStanceTimePercent(newRecord.getStanceTimePercent()) }
    if !oldRecord.isStanceTimeValid() && newRecord.isStanceTimeValid() { oldRecord.setStanceTime(newRecord.getStanceTime()) }
    if !oldRecord.isActivityTypeValid() && newRecord.isActivityTypeValid() { oldRecord.setActivityType(newRecord.getActivityType()) }
    if !oldRecord.isLeftTorqueEffectivenessValid() && newRecord.isLeftTorqueEffectivenessValid() { oldRecord.setLeftTorqueEffectiveness(newRecord.getLeftTorqueEffectiveness()) }
    if !oldRecord.isRightTorqueEffectivenessValid() && newRecord.isRightTorqueEffectivenessValid() { oldRecord.setRightTorqueEffectiveness(newRecord.getRightTorqueEffectiveness()) }
    if !oldRecord.isLeftPedalSmoothnessValid() && newRecord.isLeftPedalSmoothnessValid() { oldRecord.setLeftPedalSmoothness(newRecord.getLeftPedalSmoothness()) }
    if !oldRecord.isRightPedalSmoothnessValid() && newRecord.isRightPedalSmoothnessValid() { oldRecord.setRightPedalSmoothness(newRecord.getRightPedalSmoothness()) }
    if !oldRecord.isCombinedPedalSmoothnessValid() && newRecord.isCombinedPedalSmoothnessValid() { oldRecord.setCombinedPedalSmoothness(newRecord.getCombinedPedalSmoothness()) }
    if !oldRecord.isTime128Valid() && newRecord.isTime128Valid() { oldRecord.setTime128(newRecord.getTime128()) }
    if !oldRecord.isStrokeTypeValid() && newRecord.isStrokeTypeValid() { oldRecord.setStrokeType(newRecord.getStrokeType()) }
    if !oldRecord.isZoneValid() && newRecord.isZoneValid() { oldRecord.setZone(newRecord.getZone()) }
    if !oldRecord.isBallSpeedValid() && newRecord.isBallSpeedValid() { oldRecord.setBallSpeed(newRecord.getBallSpeed()) }
    if !oldRecord.isCadence256Valid() && newRecord.isCadence256Valid() { oldRecord.setCadence256(newRecord.getCadence256()) }
    if !oldRecord.isFractionalCadenceValid() && newRecord.isFractionalCadenceValid() { oldRecord.setFractionalCadence(newRecord.getFractionalCadence()) }
    if !oldRecord.isTotalHemoglobinConcValid() && newRecord.isTotalHemoglobinConcValid() { oldRecord.setTotalHemoglobinConc(newRecord.getTotalHemoglobinConc()) }
    if !oldRecord.isTotalHemoglobinConcMinValid() && newRecord.isTotalHemoglobinConcMinValid() { oldRecord.setTotalHemoglobinConcMin(newRecord.getTotalHemoglobinConcMin()) }
    if !oldRecord.isTotalHemoglobinConcMaxValid() && newRecord.isTotalHemoglobinConcMaxValid() { oldRecord.setTotalHemoglobinConcMax(newRecord.getTotalHemoglobinConcMax()) }
    if !oldRecord.isSaturatedHemoglobinPercentValid() && newRecord.isSaturatedHemoglobinPercentValid() { oldRecord.setSaturatedHemoglobinPercent(newRecord.getSaturatedHemoglobinPercent()) }
    if !oldRecord.isSaturatedHemoglobinPercentMinValid() && newRecord.isSaturatedHemoglobinPercentMinValid() { oldRecord.setSaturatedHemoglobinPercentMin(newRecord.getSaturatedHemoglobinPercentMin()) }
    if !oldRecord.isSaturatedHemoglobinPercentMaxValid() && newRecord.isSaturatedHemoglobinPercentMaxValid() { oldRecord.setSaturatedHemoglobinPercentMax(newRecord.getSaturatedHemoglobinPercentMax()) }
    if !oldRecord.isDeviceIndexValid() && newRecord.isDeviceIndexValid() { oldRecord.setDeviceIndex(newRecord.getDeviceIndex()) }
    if !oldRecord.isLeftPcoValid() && newRecord.isLeftPcoValid() { oldRecord.setLeftPco(newRecord.getLeftPco()) }
    if !oldRecord.isRightPcoValid() && newRecord.isRightPcoValid() { oldRecord.setRightPco(newRecord.getRightPco()) }
    // if !oldRecord.isLeftPowerPhaseValid() && newRecord.isLeftPowerPhaseValid() { oldRecord.setLeftPowerPhase(newRecord.getLeftPowerPhase()) }
    // if !oldRecord.isLeftPowerPhasePeakValid() && newRecord.isLeftPowerPhasePeakValid() { oldRecord.setLeftPowerPhasePeak(newRecord.getLeftPowerPhasePeak()) }
    // if !oldRecord.isRightPowerPhaseValid() && newRecord.isRightPowerPhaseValid() { oldRecord.setRightPowerPhase(newRecord.getRightPowerPhase()) }
    // if !oldRecord.isRightPowerPhasePeakValid() && newRecord.isRightPowerPhasePeakValid() { oldRecord.setRightPowerPhasePeak(newRecord.getRightPowerPhasePeak()) }
    if !oldRecord.isEnhancedSpeedValid() && newRecord.isEnhancedSpeedValid() { oldRecord.setEnhancedSpeed(newRecord.getEnhancedSpeed()) }
    if !oldRecord.isEnhancedAltitudeValid() && newRecord.isEnhancedAltitudeValid() { oldRecord.setEnhancedAltitude(newRecord.getEnhancedAltitude()) }
    if !oldRecord.isBatterySocValid() && newRecord.isBatterySocValid() { oldRecord.setBatterySoc(newRecord.getBatterySoc()) }
    if !oldRecord.isMotorPowerValid() && newRecord.isMotorPowerValid() { oldRecord.setMotorPower(newRecord.getMotorPower()) }
    if !oldRecord.isVerticalRatioValid() && newRecord.isVerticalRatioValid() { oldRecord.setVerticalRatio(newRecord.getVerticalRatio()) }
    if !oldRecord.isStanceTimeBalanceValid() && newRecord.isStanceTimeBalanceValid() { oldRecord.setStanceTimeBalance(newRecord.getStanceTimeBalance()) }
    if !oldRecord.isStepLengthValid() && newRecord.isStepLengthValid() { oldRecord.setStepLength(newRecord.getStepLength()) }
    if !oldRecord.isCycleLength16Valid() && newRecord.isCycleLength16Valid() { oldRecord.setCycleLength16(newRecord.getCycleLength16()) }
    if !oldRecord.isAbsolutePressureValid() && newRecord.isAbsolutePressureValid() { oldRecord.setAbsolutePressure(newRecord.getAbsolutePressure()) }
    if !oldRecord.isDepthValid() && newRecord.isDepthValid() { oldRecord.setDepth(newRecord.getDepth()) }
    if !oldRecord.isNextStopDepthValid() && newRecord.isNextStopDepthValid() { oldRecord.setNextStopDepth(newRecord.getNextStopDepth()) }
    if !oldRecord.isNextStopTimeValid() && newRecord.isNextStopTimeValid() { oldRecord.setNextStopTime(newRecord.getNextStopTime()) }
    if !oldRecord.isTimeToSurfaceValid() && newRecord.isTimeToSurfaceValid() { oldRecord.setTimeToSurface(newRecord.getTimeToSurface()) }
    if !oldRecord.isNdlTimeValid() && newRecord.isNdlTimeValid() { oldRecord.setNdlTime(newRecord.getNdlTime()) }
    if !oldRecord.isCnsLoadValid() && newRecord.isCnsLoadValid() { oldRecord.setCnsLoad(newRecord.getCnsLoad()) }
    if !oldRecord.isN2LoadValid() && newRecord.isN2LoadValid() { oldRecord.setN2Load(newRecord.getN2Load()) }
    if !oldRecord.isRespirationRateValid() && newRecord.isRespirationRateValid() { oldRecord.setRespirationRate(newRecord.getRespirationRate()) }
    if !oldRecord.isEnhancedRespirationRateValid() && newRecord.isEnhancedRespirationRateValid() { oldRecord.setEnhancedRespirationRate(newRecord.getEnhancedRespirationRate()) }
    if !oldRecord.isGritValid() && newRecord.isGritValid() { oldRecord.setGrit(newRecord.getGrit()) }
    if !oldRecord.isFlowValid() && newRecord.isFlowValid() { oldRecord.setFlow(newRecord.getFlow()) }
    if !oldRecord.isCurrentStressValid() && newRecord.isCurrentStressValid() { oldRecord.setCurrentStress(newRecord.getCurrentStress()) }
    if !oldRecord.isEbikeTravelRangeValid() && newRecord.isEbikeTravelRangeValid() { oldRecord.setEbikeTravelRange(newRecord.getEbikeTravelRange()) }
    if !oldRecord.isEbikeBatteryLevelValid() && newRecord.isEbikeBatteryLevelValid() { oldRecord.setEbikeBatteryLevel(newRecord.getEbikeBatteryLevel()) }
    if !oldRecord.isEbikeAssistModeValid() && newRecord.isEbikeAssistModeValid() { oldRecord.setEbikeAssistMode(newRecord.getEbikeAssistMode()) }
    if !oldRecord.isEbikeAssistLevelPercentValid() && newRecord.isEbikeAssistLevelPercentValid() { oldRecord.setEbikeAssistLevelPercent(newRecord.getEbikeAssistLevelPercent()) }
    if !oldRecord.isAirTimeRemainingValid() && newRecord.isAirTimeRemainingValid() { oldRecord.setAirTimeRemaining(newRecord.getAirTimeRemaining()) }
    if !oldRecord.isPressureSacValid() && newRecord.isPressureSacValid() { oldRecord.setPressureSac(newRecord.getPressureSac()) }
    if !oldRecord.isVolumeSacValid() && newRecord.isVolumeSacValid() { oldRecord.setVolumeSac(newRecord.getVolumeSac()) }
    if !oldRecord.isRmvValid() && newRecord.isRmvValid() { oldRecord.setRmv(newRecord.getRmv()) }
    if !oldRecord.isAscentRateValid() && newRecord.isAscentRateValid() { oldRecord.setAscentRate(newRecord.getAscentRate()) }
    if !oldRecord.isPo2Valid() && newRecord.isPo2Valid() { oldRecord.setPo2(newRecord.getPo2()) }
    if !oldRecord.isCoreTemperatureValid() && newRecord.isCoreTemperatureValid() { oldRecord.setCoreTemperature(newRecord.getCoreTemperature()) }
    return oldRecord
}
