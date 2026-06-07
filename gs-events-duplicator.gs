if(debug) {
  let debugLogs = [];
}

// Is the event an all-day event.
function isAllDay(startTime, endTime) {
  // All day means it starts at 12:00 AM and ends at 12:00 AM the next day
  return startTime.getHours() === 0 && startTime.getMinutes() === 0 &&
         endTime.getHours() === 0 && endTime.getMinutes() === 0 &&
         (endTime - startTime) === 24 * 60 * 60 * 1000; // Exactly 1 day
}

function isMultiDay(startTime, endTime) {
  // Event spans more than 24 hours OR starts and ends on different days (but not exactly 24 hours).
  return (endTime - startTime) > 24 * 60 * 60 * 1000 ||
         (startTime.toDateString() !== endTime.toDateString() && (endTime - startTime) !== 24 * 60 * 60 * 1000);
}

function copyNewEventsFromMultipleCalendars() {
  // Check if synchronization is globally enabled
  if (typeof enableSynchronization !== 'undefined' && !enableSynchronization) {
    Logger.log('Synchronization is globally disabled in configuration.');
    return;
  }
  debugLogs = []; // Clear previous debug logs at the start of each run
  var lock = LockService.getScriptLock();

  try {
    lock.tryLock(10000);
    if (!lock.hasLock()) {
      Logger.log('Another instance of the script is already running.');
      return;
    }
    
    var destinationCalendar = CalendarApp.getCalendarById(destinationCalendarId);
    var emailSummary = [];
    var eventSourcesMap = {};

    for (var calendarName in sourceCalendars) {
      var sourceCalendarId = sourceCalendars[calendarName];
      var sourceCalendar = CalendarApp.getCalendarById(sourceCalendarId);

      if (sourceCalendar) {

        var events = sourceCalendar.getEvents(timeWindow.start, timeWindow.end);

        events.forEach(function(event) {

          var uniqueIdentifier = createEventIdentifier(event); // Create unique identifier based on event properties
          var startTime = event.getStartTime();
          var endTime = event.getEndTime();
          var description = event.getDescription() || "";
          var location = event.getLocation() || "";

          // Check if this event has already been found in another calendar
          if (eventSourcesMap[uniqueIdentifier]) {
            eventSourcesMap[uniqueIdentifier].calendars.push(calendarName);
          } else {
            eventSourcesMap[uniqueIdentifier] = {
              calendars: [calendarName],
              title: event.getTitle(),
              startTime: startTime,
              endTime: endTime,
              description: description,
              location: location
            };
          }
        });
      } else {
        // Log a failure to retrieve a given calendar.
        emailSummary.push('Calendar not found: ' + calendarName);
      }
    }


for (var uniqueIdentifier in eventSourcesMap) {
  var eventInfo = eventSourcesMap[uniqueIdentifier];
  var titlePrefix = eventInfo.calendars.join(', ');
  var title = titlePrefix + ": " + eventInfo.title;
  var startTime = eventInfo.startTime;
  var endTime = eventInfo.endTime;
  var description = eventInfo.description;
  var location = eventInfo.location;

  // Check if the event is an all-day event (12:00 AM start and 12:00 AM end the next day)
  var isAllDayEvent = isAllDay(startTime, endTime);
  // Check if the event is greater than 24-hours long.
  var isEventMultiDay = isMultiDay(startTime, endTime);

  var existingEvent = findEventBySourceIdentifier(destinationCalendar, uniqueIdentifier, timeWindow.start, timeWindow.end);

  if (existingEvent) {
    var shouldUpdate = needsUpdate(existingEvent, eventInfo, title, startTime, endTime, description, location, uniqueIdentifier);

    if (debug) { // Add debug logs
      debugLogs.push('Existing event details: Title: ' + existingEvent.getTitle() + ', Start: ' + existingEvent.getStartTime() + ', End: ' + existingEvent.getEndTime());
      debugLogs.push('New event details: Title: ' + title + ', Start: ' + startTime + ', End: ' + endTime);
      debugLogs.push('Is Multi-Day Event: ' + isEventMultiDay);
      debugLogs.push('Needs update: ' + shouldUpdate + '\n');
    }

    if (shouldUpdate) {
      existingEvent.setTitle(title);
      if (isAllDayEvent) {
        // Set as all-day event
        existingEvent.setAllDayDate(startTime);
      } else {
        existingEvent.setTime(startTime, endTime);
      }
      existingEvent.setDescription(description + '\nSource Event ID: ' + uniqueIdentifier);
      existingEvent.setLocation(location);
      emailSummary.push('Updated event: ' + title);
    }
  } else {
    if (isAllDayEvent) {
      // Create as all-day event
      destinationCalendar.createAllDayEvent(title, startTime, {
        description: description + '\nSource Event ID: ' + uniqueIdentifier,
        location: location
      });
    } else {
      destinationCalendar.createEvent(title, startTime, endTime, {
        description: description + '\nSource Event ID: ' + uniqueIdentifier,
        location: location
      });
    }
    emailSummary.push('Created new event: ' + title);
  }
}


    sendSyncReport(emailSummary, emails);

  } catch (e) {
    Logger.log('Error during execution: ' + e.message);
    MailApp.sendEmail({
      to: 'bino@princeton.edu',
      subject: 'Error in Calendar Sync Script',
      body: 'An error occurred during the calendar sync operation: \n\n' + e.message + '\n\nStack trace: \n' + e.stack
    });
  } finally {
    lock.releaseLock();
  }
}

// Function to create a unique identifier for an event based on title, start time, and end time
function createEventIdentifier(event) {
  var title = event.getTitle();
  if (title.includes(": ")) {
    title = title.split(": ", 2)[1]; // Remove the prefix
  }
  return title + "_" + event.getStartTime().getTime() + "_" + event.getEndTime().getTime();
}

// Function to find an event by its unique identifier in the destination calendar
function findEventBySourceIdentifier(calendar, uniqueIdentifier, startTime, endTime) {
  var events = calendar.getEvents(startTime, endTime);
  for (var i = 0; i < events.length; i++) {
    var eventDescription = events[i].getDescription();
    if (eventDescription && eventDescription.includes('Source Event ID: ' + uniqueIdentifier)) {
      return events[i]; // Found the matching event
    }
  }
  return null; // No matching event found
}

// Function to calculate time window for synchronization
function getTimeWindow(monthsBack, monthsForward) {
  var now = new Date();
  return {
    start: new Date(now.getTime() - (monthsBack * 30 * 24 * 60 * 60 * 1000)),
    end: new Date(now.getTime() + (monthsForward * 30 * 24 * 60 * 60 * 1000))
  };
}

// Function to determine if an event needs to be updated
function needsUpdate(existingEvent, sourceEvent, title, startTime, endTime, description, location, uniqueIdentifier) {
  var existingTitle = existingEvent.getTitle();
  var existingDescription = existingEvent.getDescription();
  var hasSourceId = existingDescription.includes('Source Event ID: ' + uniqueIdentifier);

  // Normalize whitespace and compare main descriptions
  var existingMainDescription = existingDescription.split('\nSource Event ID: ')[0].trim();
  var sourceMainDescription = description.split('\nSource Event ID: ')[0].trim();

  // Remove prefix from the existing title for comparison
  var prefix = existingTitle.split(":")[0]; // Extracting the prefix before the first colon
  var titleWithoutPrefix = existingTitle.replace(prefix + ": ", "").trim(); // Removing the prefix

  // Collect debug information if debug is enabled
  if (debug) {
    debugLogs.push('needsUpdate checks:');
    debugLogs.push('Source Event ID:' + uniqueIdentifier);
    debugLogs.push('Source Event ID missing: ' + !hasSourceId);
    debugLogs.push('Existing title: "' + existingTitle + '"');
    debugLogs.push('Title without prefix: "' + titleWithoutPrefix + '"');
    debugLogs.push('Source event title: "' + sourceEvent.title.trim() + '"');
    debugLogs.push('Title mismatch: ' + (titleWithoutPrefix.toLowerCase() !== sourceEvent.title.trim().toLowerCase()));
    debugLogs.push('Start time mismatch: ' + (existingEvent.getStartTime().getTime() !== startTime.getTime()));
    debugLogs.push('End time mismatch: ' + (existingEvent.getEndTime().getTime() !== endTime.getTime()));
    debugLogs.push('Description mismatch: ' + (existingMainDescription !== sourceMainDescription));
    debugLogs.push('Location mismatch: ' + (existingEvent.getLocation().trim() !== location.trim()));
    const allDayStatus = isAllDay(startTime, endTime);
    debugLogs.push('Is All Day Event: ' + allDayStatus);
  }

  return (
    !hasSourceId || // Update if Source Event ID is missing
    titleWithoutPrefix.toLowerCase() !== sourceEvent.title.trim().toLowerCase() || // Compare existing title without prefix
    existingEvent.getStartTime().getTime() !== startTime.getTime() || // Update if start time is different
    existingEvent.getEndTime().getTime() !== endTime.getTime() || // Update if end time is different
    existingMainDescription !== sourceMainDescription || // Update if the main description has changed
    existingEvent.getLocation().trim() !== location.trim() // Update if the location has changed
  );
}



// Update sendSyncReport function to include debug logs only if debug is enabled
// Code.gs
function sendSyncReport(summary, emails) {
  var subject = 'Calendar Sync Report';
  var body = summary.length > 0 ? summary.join('\n') : 'No events were synchronized.';

  if (debug) {
    body += '\n\n--- Debug Logs ---\n' + debugLogs.join('\n');
  }

  // Send the email to each address in the emails array
  emails.forEach(function(email) {
    MailApp.sendEmail(email, subject, body);
  });
}
