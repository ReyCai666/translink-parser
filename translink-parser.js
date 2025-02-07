import fetch from 'node-fetch';
import { parse } from 'csv-parse/sync';
import promptSync from 'prompt-sync';
const prompt = promptSync({ sigint: true });
import fs from 'fs/promises';

let cachedStaticRoutes = [];
let cachedStaticTrips = [];
let cachedStaticCalendarDates = [];
let cachedStaticStopTimes = [];
let cachedStaticCalendar = [];
let cachedStaticStops = [];
let cachedLiveTripUpdates = [];
let cachedLiveVehiclePositions = [];
let lastLiveTripFetchTime = 0;
let lastLiveVehicleFetchTime = 0;


/**
 * Check if the given date is valid.
 * calendar_dates.txt only includes data within year 2023.
 * @param {string} date 
 * @returns {boolean|string} true if date is valid, false otherwise. 
 *                           string if date is not within 2023.
 */
function isValidDate(date) {
    const dateArr = date.split("-");
    const year = parseInt(dateArr[0]);
    const month = parseInt(dateArr[1]);
    const day = parseInt(dateArr[2]);
    const oddMonth = [1,3,5,7,8,10,12];
    const evenMonth = [4,6,9,11];
    // does not include date outside of year 2023.
    if (year != 2023) {
        return "data not found";
        
    }
    if (month < 1 || month > 12) {
        return false;
    }
    if (day < 1 || day > 31) {
        return false;
    }
    if (month == 2 && day > 28) {
        return false;
    }
    if (oddMonth.includes(month) && day > 31) {
        return false;
    }
    if (evenMonth.includes(month) && day > 30) {
        return false;
    }
    return true;
}

/**
 * Get the departure date from the user and check if it is valid.
 * @returns {string} date in YYYY-MM-DD format.
 */
function getDepartureDate() {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    let input = prompt("What date will you depart UQ Lakes station by bus?");
    if (!input.match(dateRegex) || !isValidDate(input)) {
        console.log("Incorrect date format. Please use YYYY-MM-DD");
        return getDepartureDate();
    } else if (isValidDate(input) == "data not found") {
        console.log("Only supports data within year 2023. Please try agin.");
        return getDepartureDate();
    } else {
        return input;
    }
}

/**
 * Get the departure time from the user and check if it is valid.
 * @returns {string} time in HH:mm format.
 */
function getDepartureTime() {
    const timeRegex = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
    let timePrompt = prompt("What time will you depart UQ Lakes station by bus?");
    if (!timePrompt.match(timeRegex)) {
        console.log("Incorrect time format. Please use HH:mm");
        return getDepartureTime();
    }
    return timePrompt;
}

/**
 * Parse the given file and filter out the data that is not required.
 * @async
 * @param {string} filename file name to be parsed.
 * @throws {Error} if the given filename is invalid.
 */
async function parseCSV(filename) {
    const filePath = `./static-data/${filename}.txt`;
    try {
        const data = await fs.readFile(filePath, 'utf8');
        const records = parse(data, {
            delimiter: ",",
            columns: true,
            trim: true
        });
        // use set to optimize search runtime O(1).
        if (filePath.includes("routes.txt")) {
            cachedStaticRoutes = records;
            // only need routes that have "uq " in route_long_name
            cachedStaticRoutes = cachedStaticRoutes.filter((row) => 
                row['route_long_name'].toLowerCase().includes("uq ")
            );
        } else if (filePath.includes("trips.txt")) {
            const routeIdsSet = new Set(cachedStaticRoutes
                                        .map(route => route['route_id']));
            cachedStaticTrips = records.filter(row => routeIdsSet
                                               .has(row['route_id']));
        } else if (filePath.includes("calendar_dates.txt")) {
            // cache the whole file as it is small.
            cachedStaticCalendarDates = records;
        } else if (filePath.includes("stop_times.txt")) { 
            // only need stop_times with uq bus trip_id
            const tripIdsSet = new Set(cachedStaticTrips
                                       .map(trip => trip['trip_id']));
            cachedStaticStopTimes = records.filter(row => tripIdsSet
                                                   .has(row['trip_id']));
        } else if (filePath.includes("calendar.txt")) {
            cachedStaticCalendar = records;
        } else if (filePath.includes("stops.txt")) {
            const stopIdsSet = new Set(cachedStaticStopTimes
                                       .map(stop => stop['stop_id']));
            cachedStaticStops = records.filter(row => stopIdsSet
                                               .has(row['stop_id']));
        } else {
            throw new Error("Invalid file name");
        }
    } catch (error) {
        console.log(error);
    }
}

/**
 * Read the given file and save the data to the cached-data directory.
 * @async
 * @param {string} filename filename to be read.
 * @throws {Error} if the given filename is invalid.
 */
async function readJSON(filename) {
    try {
        const filePath = `./cached-data/${filename}`;
        const data = await fs.readFile(filePath, 'utf8');
        const parsedData = await JSON.parse(data);

        if (filename.includes("trip_updates.json")) {
            lastLiveTripFetchTime = parseInt(parsedData.header.timestamp, 10);
            cachedLiveTripUpdates = parsedData;
        } else if (filename.includes("vehicle_positions.json")) {
            lastLiveVehicleFetchTime = parseInt(parsedData.header.timestamp, 10);
            cachedLiveVehiclePositions = parsedData;
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            await fetchAndSaveLiveBusData(filename);
        }
    }
}

/**
 * Fetch the given file from the server and save the data to the cached-data directory.
 * @async
 * @param {string} filename filename to be fetched and saved.
 * @throws {Error} if the given filename is invalid.
 */
async function fetchAndSaveLiveBusData(filename) {
    const url = `http://127.0.0.1:5343/gtfs/seq/${filename}`;
    const saveTo = `cached-data/${filename}`;
    const UQRouteId = [
                        '28-3195',   '29-3195',
                        '66-3136',   '66-3195',
                        '139-3195',  '169-3136',
                        '169-3195',  '192-3195',
                        '209-3136',  '209-3195',
                        'P332-3195'
                      ];
    const UQStopId = ['1853', '1878', '1882', '1947'];

    try {
        const response = await fetch(url);
        const parsedLiveData = await response.json();
        const fetchedTime = parseInt(parsedLiveData.header.timestamp, 10);
        let UQRelatedData = [];
        if (filename.includes("trip_updates.json")) {
            if (fetchedTime - lastLiveTripFetchTime >= (5 * 60)) {
                lastLiveTripFetchTime = fetchedTime;
                // filter out the non-uq bus routes.
                UQRelatedData = parsedLiveData.entity.filter((row) => {
                    return UQRouteId.includes(row.tripUpdate.trip.routeId)
                });
                // filter out all the stop information that is not a UQ stop.
                UQRelatedData = UQRelatedData.map((data) => {
                    let filteredStops = data.tripUpdate.stopTimeUpdate.filter((stopInfo) => {
                        return UQStopId.includes(stopInfo.stopId);
                    });
                    data.tripUpdate.stopTimeUpdate = filteredStops;
                    return data;
                }).filter((data) => data.tripUpdate.stopTimeUpdate.length > 0);
        
                const outputData = {
                    header: parsedLiveData.header,
                    entity: UQRelatedData
                };
                // write to the cached-data directory with the json data.
                await fs.writeFile(saveTo, JSON.stringify(outputData, null, 4));
            }
        }
        if (filename.includes("vehicle_positions.json")) {
            if (fetchedTime - lastLiveVehicleFetchTime >= (5 * 60)) {
                lastLiveVehicleFetchTime = fetchedTime;
                // filter out the non-uq bus routes.
                await fs.writeFile(saveTo, JSON.stringify(parsedLiveData, null, 4));
            }
        }
    } catch (error) {
        console.log(error);
    }
 }

/**
 * Get all the unique busId from the static Routes.txt.
 * @returns {string} busId that the user wants to take.
 */
function getStaticUnqiueUQBusId() {
    const busIds = cachedStaticRoutes.map((row) => row['route_short_name']);
    // remove duplicates
    const uniqueBusIds = [...new Set(busIds)];
    return uniqueBusIds;
}

/**
 * Get the prompt message for the user to select a bus route.
 */
function getRoutePromptMessage() {
    const allStaticUniqueBusId = getStaticUnqiueUQBusId();
    let routePromptMessage = "What Bus Route would you like to take?\n";
    routePromptMessage += "1 - Show All Routes\n";
    for (let i = 2; i < 10; i++) {
        routePromptMessage += `${i} - ${allStaticUniqueBusId[i-2]}\n`;
    }
    console.log(routePromptMessage);
}

/**
 * Get the busId that the user wants to take.
 * @returns {string} busId that the user wants to take.
 */
function getUserBusId() {
    const busIdPromptMessage = getRoutePromptMessage();
    const userBusId = prompt(busIdPromptMessage);
    const option = parseInt(userBusId, 10);
    if (!Number.isInteger(option) || option < 1 || option > 9 
        || userBusId !== option.toString()) {
        console.log("Please enter a valid option for a bus route.");
        return getUserBusId();
    } else {
        return getBusIdByOption(option);
    }
}

/**
 * Get the busId that the user wants to take.
 * @param {string} option selected by the user.
 * @returns {Array} array of busId that the user wants to take.
 */
function getBusIdByOption(option) {
    const result = [];
    const busId = getStaticUnqiueUQBusId();
    if (option == 1) {
        return busId;
    } else {
        result.push(busId[option-2]);
    }
    return result
}

/**
 * Get the long name of the bus route by the given busId.
 * @param {string} busId to be searched.
 * @returns {Array} array of long name of the bus route. 
 */
function getLongNameByBusId(busId) {
    const matchingLongNameRows = cachedStaticRoutes.filter((row) => {
        return row['route_short_name'] == busId;
    });
    const longNames = matchingLongNameRows.map((row) => row['route_long_name']);
    const uniqueLongNames = [...new Set(longNames)];
    return uniqueLongNames;
}

/**
 * Get the routeId by the given busIds.
 * @param {Array} busId array of busId to be searched. 
 * @returns {Array} array of routeId.
 */
function getRouteIdByBusId(busId) {
    const routeIdArr = [];
    const routeId = cachedStaticRoutes.filter((row) =>{
        return busId.includes(row['route_short_name']);
    });
    routeId.map((row) => {
        routeIdArr.push(row['route_id']);
    });

    return routeIdArr;
}

/**
 * Get the static trips by the given routeId.
 * @param {Array} routeIdArr Array of routeId to be searched.
 * @returns {Array} array of static trips object.
 */
function getStaticTrips(routeIdArr) {
    const matchingTrips = cachedStaticTrips.filter((row) => {
        return routeIdArr.includes(row['route_id']);
    });
    return matchingTrips;
}

/**
 * Convert the given date string to Date object.
 * @param {String} str date in YYYYMMDD format.
 * @returns {Date} date in YYYY-MM-DD format.
 */
function toDate(str) {
    const year = str.substring(0, 4);
    const month = str.substring(4, 6);
    const day = str.substring(6, 8);

    return new Date(`${year}-${month}-${day}`);
}

/**
 * Check if the given serviceId is valid for the given date by linking with 
 * the calendar.txt and calendar_dates.txt.
 * @param {string} serviceId to be checked.
 * @param {string} travelDate to be checked.
 * @returns 
 */
function isValidServiceId(serviceId, travelDate) {
    let date = new Date(travelDate);
    let day = date.getDay();
    let counter = 0;
    const serviceIdRow = cachedStaticCalendarDates.filter((row) => {
        return row['service_id'] == serviceId && toDate(row['date']) == date 
                                              && row['exception_type'] == 2;
    });

    if (serviceIdRow.length == 0) {
        return cachedStaticCalendar.some((row) => {
            if (row['service_id'] == serviceId) {
                if (toDate(row['start_date']) <= date && date <= toDate(row['end_date'])) {
                    if (row['monday'] == 1 && day == 1) {
                        return true;
                    } else if (row['tuesday'] == 1 && day == 2) {
                        return true;
                    } else if (row['wednesday'] == 1 && day == 3) {
                        return true;
                    } else if (row['thursday'] == 1 && day == 4) {
                        return true;
                    } else if (row['friday'] == 1 && day == 5) {
                        return true;
                    } else if (row['saturday'] == 1 && day == 6) {
                        return true;
                    } else if (row['sunday'] == 1 && day == 0) {
                        return true;
                    } else {
                        return false;
                    }
                } else {
                    return false;
                }
            }   
        });
    } else {
        return false;
    }
}

/**
 * Convert the given time string to minutes.
 * @param {string} time to be converted to minutes. 
 * @returns {number} time in minutes.
 */
function timeToMinutes(time) {
    let timeSliced = time.split(':').map((x) => parseInt(x, 10));
    let hours = timeSliced[0];
    let minutes = timeSliced[1];
    return hours * 60 + minutes;
}

/**
 * Get the latest trip (less than 10 minutes of the departureTime) by the 
 * given tripId and departureTime.
 * @param {string} tripId used to search for the stop times.
 * @param {string} departureTime used to search for the stop times.
 * @returns 
 */
function getLatestTrip(tripId, departureTime) {
    const departureTimeInMinutes = timeToMinutes(departureTime);
    const matchingStopTimes = cachedStaticStopTimes.filter((row) => {
        let timeDifferece = -1;
        const readArrivalTime = timeToMinutes(row['arrival_time'].slice(0, 5));

        if (readArrivalTime >= departureTimeInMinutes)  {
            timeDifferece = readArrivalTime - departureTimeInMinutes;
        }  
        return row['trip_id'] == tripId && timeDifferece >= 0 && timeDifferece <= 10;
    });
    return matchingStopTimes;
}

/**
 * Filter out the stop times that are not UQ stops.
 * @param {Array} validStopTimes to be filtered.
 * @returns {Array} array of valid stop times that are UQ stops.
 */
function filterStopsByStopTimes(validStopTimes) {
    const validUQStops = validStopTimes.filter((row) => {
        const matchingStop = cachedStaticStops.find((stop) => {
            return stop['stop_id'] == row['stop_id'] &&
                   stop['stop_name'].toLowerCase().includes("uq lakes") &&
                   stop['stop_id'] != 'place_uqlksa';
        });
        return matchingStop;
    });
    return validUQStops;
}

/**
 * Get the trip object by the given tripId.
 * @param {string} tripId used to search for the trip.
 * @returns {Array} array of trip object that matches the given tripId.
 */
function getTripById(tripId) {
    const matchingTrip = cachedStaticTrips.filter((row) => {
        return row['trip_id'] == tripId;
    });
    return matchingTrip;
}

/**
 * Get the busId by the given tripId.
 * @param {string} tripId used to search for the busId. 
 * @returns {string} busId that matches the given tripId.
 */
function getBusIdByTripId(tripId) {
    const matchingTrip = cachedStaticTrips.filter((row) => {
        return row['trip_id'] == tripId;
    });
    const matchingRoute = cachedStaticRoutes.filter((row) => {
        return row['route_id'] == matchingTrip[0]['route_id'];
    });
    return matchingRoute[0]['route_short_name'];
}

/**
 * Add a row to the table.
 * @param {string} shortName of the bus.
 * @param {string} longName of the bus.
 * @param {string} serviceId of the trip.
 * @param {string} headingSign of the bus.
 * @param {string} scheduledArrivalTime static arrival time of the bus.
 * @param {string} liveArrivalTime live arrival time of the bus.
 * @param {string} livePosition live position of the bus.
 * @param {table} table to be added to.
 */
function addRow(shortName, longName, serviceId, headingSign, 
                scheduledArrivalTime, liveArrivalTime, livePosition, table) {
    const dataRow = {
                        "Short Name" : shortName,
                        "Long Name" : longName,
                        "Service Id" : serviceId,
                        "Heading Sign" : headingSign,
                        "Scheduled Arrival Time" : scheduledArrivalTime,
                        "Live Arrival Time" : liveArrivalTime,
                        "Live Position" : livePosition
                    };
    table.push(dataRow);
}

/**
 * Get the live arrival time by the given tripId.
 * @param {string} trip_id used to search for the live arrival time.
 * @returns {Array} array of live arrival time that matches the given trip_id.
 */
function getLiveArrivalTime(trip_id) {
    const matchingData = cachedLiveTripUpdates.entity
        .filter((data) => {
            return trip_id == data.tripUpdate.trip.tripId;
        });
    return matchingData;
}

/**
 * Get the live vehicle position by the given tripId.
 * @param {string} trip_id used to search for the live vehicle position.
 * @returns {Array} array of live vehicle position that matches the given trip_id.
 */
function getLiveVehiclePos(trip_id) {
    const matchingData = cachedLiveVehiclePositions.entity
        .filter((data) => {
            return data.vehicle.trip.tripId == trip_id;
        });
    return matchingData;
}

/**
 * Convert the given epoch time to HH:mm:ss format.
 * @param {Number} epoch time in epoch format.
 * @returns {string} time in HH:mm:ss format.
 */
function epochToTime(epoch) {
    const date = new Date(epoch * 1000);
    let hours = date.getHours();
    let minutes = date.getMinutes();
    let seconds = date.getSeconds();
    if (minutes < 10) {
        minutes = "0" + minutes;
    }
    if (seconds < 10) {
        seconds = "0" + seconds;
    }
    if (hours < 10) {
        hours = "0" + hours;
    }
    return `${hours}:${minutes}:${seconds}`;
}

/**
 * Parse all the static files.
 * @async
 */
async function parseAllStaticFiles() {
    // parse all files simultaneously to reduce runtime.
    await Promise.all([
        parseCSV("routes"),
        parseCSV("trips"),
        parseCSV("stop_times"),
        parseCSV("calendar_dates"),
        parseCSV("calendar"),
        // parseCSV("stops")
    ]);
    await parseCSV("stops");
}

/**
 * Read and parse all the live data.
 * @async
 */
async function readAndParseAllLiveData() {
    await readJSON("trip_updates.json");
    await fetchAndSaveLiveBusData("trip_updates.json");
    await readJSON("trip_updates.json");

    await readJSON("vehicle_positions.json");
    await fetchAndSaveLiveBusData("vehicle_positions.json");
    await readJSON("vehicle_positions.json");
}

/**
 * Prompt the user if they want to search again and check if the input is valid.
 * @returns {boolean} true if the user wants to search again, false otherwise.
 */
function wantSerachAgain() {
    let input = prompt("Would you like to search again?");
    if (input.toLowerCase() == 'y' || input.toLowerCase() == 'yes') {
        return true;
    } else if (input.toLowerCase() == 'n' || input.toLowerCase() == 'no') {
        console.log("Thanks for using the UQ Lakes station bus tracker!");
        return false;
    } else {
        console.log("Please enter a valid option.")
        return wantSerachAgain();
    }
}

/**
 * Main function.
 * @async
 */
async function main() {
    let terminated = false;

    await parseAllStaticFiles();

    while (!terminated) {
        let table = [];
        let validTrips = [];
        let validStopTimes = []; 
  
        // console.log("current live data version: ", lastLiveTripFetchTime);
        await readAndParseAllLiveData();

        console.log("Welcome to the UQ Lakes station bus tracker!");

        const date = getDepartureDate();
        const time = getDepartureTime();
        const busId = getUserBusId();

        const routeIdArr = getRouteIdByBusId(busId);

        const matchingTrips = getStaticTrips(routeIdArr);
        matchingTrips.forEach((row) => {
            const isValid = isValidServiceId(row['service_id'], date);

            if (isValid) {
                validTrips.push(row);
                validStopTimes = validStopTimes.concat(getLatestTrip(row['trip_id'], time));
            }
        });
        // console.log(validStopTimes.length + " valid trips found after calendar/date check.");
        const validUQStopTimes = filterStopsByStopTimes(validStopTimes);
        // validUQStopTimes.forEach((row) => {
        //     console.log(row['trip_id'] + " : " + row['arrival_time']);
        // });
        if (validStopTimes.length == 0) {
            console.log("No trip found for the given information :(")
        }
        validUQStopTimes.map((row) => {
            const trips = getTripById(row['trip_id']);
            const busId = getBusIdByTripId(row['trip_id']);
            trips.forEach((trip) => {
                const longNames = getLongNameByBusId(busId);
                let liveArrivalTime = "no live data";
                let noLivePos = "no live data";
                const liveMatchingTrips = getLiveArrivalTime(trip['trip_id']);
                // console.log("live matching trips: \n", liveMatchingTrips);
                const liveVehiclePos = getLiveVehiclePos(trip['trip_id']);
                // console.log("live matching bus: \n", liveVehiclePos);
                let latitude = 0;
                let longitude = 0;
                let vehiclePosDisplay = `(latitude: ${latitude}, longitude: ${longitude})`;
                longNames.forEach((name) => {
                    if (liveMatchingTrips.length > 0) {
                        liveArrivalTime = liveMatchingTrips[0].tripUpdate.stopTimeUpdate[0].arrival?.time;
                            if (!liveArrivalTime) {
                                // use departure time if no arrival time.
                                liveArrivalTime = liveMatchingTrips[0].tripUpdate.stopTimeUpdate[0]?.departure?.time;
                                // console.log("using departure time: ", liveArrivalTime);
                            }
                            // console.log("liveArrivalTime: ", liveArrivalTime);
                        if (liveVehiclePos.length > 0) {
                            latitude = liveVehiclePos[0].vehicle.position.latitude;
                            longitude = liveVehiclePos[0].vehicle.position.longitude;
                            vehiclePosDisplay = `(latitude: ${latitude}, longitude: ${longitude})`;
                            addRow(busId, name, trip['service_id'], 
                                trip['trip_headsign'], row['arrival_time'], epochToTime(liveArrivalTime), vehiclePosDisplay, table);
                        } else {
                            addRow(busId, name, trip['service_id'], 
                                trip['trip_headsign'], row['arrival_time'], epochToTime(liveArrivalTime), noLivePos, table);
                        }
                    } else {
                        if (liveVehiclePos.length > 0) {
                            latitude =  liveVehiclePos[0].vehicle.position.latitude;
                            longitude = liveVehiclePos[0].vehicle.position.longitude;
                            vehiclePosDisplay = `(latitude: ${latitude}, longitude: ${longitude})`;
                            addRow(busId, name, trip['service_id'], 
                                trip['trip_headsign'], row['arrival_time'], liveArrivalTime, vehiclePosDisplay, table);
                        } else {
                            addRow(busId, name, trip['service_id'], 
                                trip['trip_headsign'], row['arrival_time'], liveArrivalTime, noLivePos, table);
                        }
                    }
                });
            });
        });
        console.table(table);
        const searchAgain = wantSerachAgain();
        if (searchAgain) {
            continue;
        } else {
            terminated = true;
        }
    }
}

await main();

