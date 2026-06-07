const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Events Duplicator Sync Tests', () => {
  function runInSandbox(customConfig = {}) {
    const sandbox = {
      // Mocks
      LockService: {
        getScriptLock: jest.fn(() => sandbox.mockLock),
      },
      CalendarApp: {
        getCalendarById: jest.fn((id) => {
          if (id === sandbox.destinationCalendarId) {
            return sandbox.mockDestinationCalendar;
          }
          if (sandbox.mockSourceCalendars[id]) {
            return sandbox.mockSourceCalendars[id];
          }
          return null;
        }),
      },
      MailApp: {
        sendEmail: jest.fn((...args) => {
          if (args.length === 1 && typeof args[0] === 'object') {
            sandbox.sentEmails.push(args[0]);
          } else {
            sandbox.sentEmails.push({ to: args[0], subject: args[1], body: args[2] });
          }
        }),
      },
      Logger: {
        log: jest.fn((msg) => {
          sandbox.loggedMessages.push(msg);
        }),
      },
      // Test records
      sentEmails: [],
      loggedMessages: [],
      // Mock objects
      mockLock: {
        _hasLock: true,
        tryLock: jest.fn(function() { this._hasLock = true; }),
        hasLock: jest.fn(function() { return this._hasLock; }),
        releaseLock: jest.fn(function() { this._hasLock = false; }),
      },
      mockDestinationCalendar: {
        events: [],
        getEvents: jest.fn(function(start, end) {
          return this.events.filter(e => e.start >= start && e.end <= end);
        }),
        createAllDayEvent: jest.fn(function(title, date, options) {
          const newEvent = sandbox.createMockEvent(title, date, new Date(date.getTime() + 24 * 60 * 60 * 1000), options.description, options.location);
          this.events.push(newEvent);
          return newEvent;
        }),
        createEvent: jest.fn(function(title, start, end, options) {
          const newEvent = sandbox.createMockEvent(title, start, end, options.description, options.location);
          this.events.push(newEvent);
          return newEvent;
        }),
      },
      mockSourceCalendars: {},
      createMockEvent: function(title, start, end, description = '', location = '') {
        const event = {
          title,
          start: new Date(start),
          end: new Date(end),
          description,
          location,
          getTitle: () => event.title,
          getStartTime: () => event.start,
          getEndTime: () => event.end,
          getDescription: () => event.description,
          getLocation: () => event.location,
          setTitle: (t) => { event.title = t; },
          setAllDayDate: (d) => {
            event.start = new Date(d);
            event.end = new Date(d.getTime() + 24 * 60 * 60 * 1000);
          },
          setTime: (s, e) => {
            event.start = new Date(s);
            event.end = new Date(e);
          },
          setDescription: (d) => { event.description = d; },
          setLocation: (l) => { event.location = l; },
        };
        return event;
      },
      Date: Date,
      debugLogs: [],
    };

    sandbox.console = console;

    // Load config and script
    const configPath = path.resolve(__dirname, '../config.gs');
    const scriptPath = path.resolve(__dirname, '../gs-events-duplicator.gs');
    let configContent = fs.readFileSync(configPath, 'utf8');
    const scriptContent = fs.readFileSync(scriptPath, 'utf8');

    // Override/Inject config values if requested
    for (const [key, value] of Object.entries(customConfig)) {
      const regex = new RegExp(`(const|var|let)\\s+${key}\\s*=([^;]+);`, 'g');
      if (regex.test(configContent)) {
        configContent = configContent.replace(regex, `$1 ${key} = ${JSON.stringify(value)};`);
      } else {
        configContent += `\nvar ${key} = ${JSON.stringify(value)};\n`;
      }
    }

    // Also copy customConfig to sandbox so mocks can access them
    for (const [key, value] of Object.entries(customConfig)) {
      sandbox[key] = value;
    }

    // If customConfig explicitly wants to test undefined enableSynchronization:
    if (customConfig.deleteEnableSynchronization) {
      configContent = configContent.replace(/(const|var|let)\s+enableSynchronization\s*=[^;]+;/g, '');
    }

    const combinedCode = configContent + '\n' + scriptContent;

    vm.createContext(sandbox);
    vm.runInContext(combinedCode, sandbox);

    return sandbox;
  }

  test('should run synchronization when enableSynchronization is true', () => {
    const sandbox = runInSandbox({
      enableSynchronization: true,
      destinationCalendarId: 'dest_calendar_id',
      sourceCalendars: { 'Work': 'source_work_id' },
      emails: ['user@example.com']
    });

    // Setup source events
    const event1 = sandbox.createMockEvent('Team Standup', new Date(), new Date(Date.now() + 30 * 60 * 1000), 'Daily sync', 'Office');
    sandbox.mockSourceCalendars['source_work_id'] = {
      getEvents: jest.fn(() => [event1])
    };

    // Run the script function
    sandbox.copyNewEventsFromMultipleCalendars();

    // Verify it executed successfully
    expect(sandbox.mockLock.tryLock).toHaveBeenCalled();
    expect(sandbox.mockDestinationCalendar.createEvent).toHaveBeenCalled();
    expect(sandbox.sentEmails.length).toBe(1);
    expect(sandbox.sentEmails[0].to).toBe('user@example.com');
    expect(sandbox.sentEmails[0].body).toContain('Created new event: Work: Team Standup');
    expect(sandbox.mockLock.releaseLock).toHaveBeenCalled();
  });

  test('should exit early and not sync when enableSynchronization is false', () => {
    const sandbox = runInSandbox({
      enableSynchronization: false,
      destinationCalendarId: 'dest_calendar_id',
      sourceCalendars: { 'Work': 'source_work_id' },
      emails: ['user@example.com']
    });

    // Run the script function
    sandbox.copyNewEventsFromMultipleCalendars();

    // Verify it exited early
    expect(sandbox.mockLock.tryLock).not.toHaveBeenCalled();
    expect(sandbox.mockDestinationCalendar.createEvent).not.toHaveBeenCalled();
    expect(sandbox.sentEmails.length).toBe(0);
    expect(sandbox.loggedMessages).toContain('Synchronization is globally disabled in configuration.');
  });

  test('should run synchronization as fallback if enableSynchronization is undefined', () => {
    const sandbox = runInSandbox({
      deleteEnableSynchronization: true,
      destinationCalendarId: 'dest_calendar_id',
      sourceCalendars: { 'Work': 'source_work_id' },
      emails: ['user@example.com']
    });

    // Setup source events
    const event1 = sandbox.createMockEvent('Team Standup', new Date(), new Date(Date.now() + 30 * 60 * 1000), 'Daily sync', 'Office');
    sandbox.mockSourceCalendars['source_work_id'] = {
      getEvents: jest.fn(() => [event1])
    };

    // Run the script function
    sandbox.copyNewEventsFromMultipleCalendars();

    // Verify it ran normally (defaulting to enabled)
    expect(sandbox.mockLock.tryLock).toHaveBeenCalled();
    expect(sandbox.mockDestinationCalendar.createEvent).toHaveBeenCalled();
    expect(sandbox.sentEmails.length).toBe(1);
  });
});
